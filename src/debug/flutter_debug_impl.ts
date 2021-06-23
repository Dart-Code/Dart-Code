import { ContinuedEvent, Event, OutputEvent } from "vscode-debugadapter";
import { DebugProtocol } from "vscode-debugprotocol";
import { FlutterCapabilities } from "../shared/capabilities/flutter";
import { debugLaunchProgressId, restartReasonManual } from "../shared/constants";
import { FlutterAttachRequestArguments, FlutterLaunchRequestArguments } from "../shared/debug/interfaces";
import { LogCategory, VmServiceExtension } from "../shared/enums";
import { AppProgress } from "../shared/flutter/daemon_interfaces";
import { DiagnosticsNode, DiagnosticsNodeLevel, DiagnosticsNodeStyle, DiagnosticsNodeType, FlutterErrorData } from "../shared/flutter/structured_errors";
import { Logger, SpawnedProcess, WidgetErrorInspectData } from "../shared/interfaces";
import { getSdkVersion } from "../shared/utils/fs";
import { DartDebugSession } from "./dart_debug_impl";
import { VMEvent } from "./dart_debug_protocol";
import { FlutterRun } from "./flutter_run";
import { DebugAdapterLogger } from "./logging";
import { RunDaemonBase, RunMode } from "./run_daemon_base";

const objectGroupName = "my-group";
const flutterExceptionStartBannerPrefix = "══╡ EXCEPTION CAUGHT BY";
const flutterExceptionEndBannerPrefix = "══════════════════════════════════════════";

export class FlutterDebugSession extends DartDebugSession {
	private runDaemon?: RunDaemonBase;
	public flutterTrackWidgetCreation = true;
	private currentRunningAppId?: string;
	private appHasStarted = false;
	private appHasBeenToldToStopOrDetach = false;
	private vmServiceUri?: string;
	private isReloadInProgress = false;
	protected readonly flutterCapabilities = FlutterCapabilities.empty;

	// Allow flipping into stderr mode for red exceptions when we see the start/end of a Flutter exception dump.
	private outputCategory: "stdout" | "stderr" | "console" = "console";

	constructor() {
		super();

		this.sendStdOutToConsole = false;
		this.allowWriteServiceInfo = false;
		// We get the VM service URI from the `flutter run` process. If we parse
		// it out of verbose logging and connect to it, it'll be before Flutter is
		// finished setting up and bad things can happen (like us sending events
		// way too early).
		this.parseVmServiceUriFromStdOut = false;
		this.requiresProgram = false;
		this.logCategory = LogCategory.FlutterRun;

		// Enable connecting the VM even for noDebug mode so that service
		// extensions can be used.
		this.connectVmEvenForNoDebug = true;
	}

	protected initializeRequest(
		response: DebugProtocol.InitializeResponse,
		args: DebugProtocol.InitializeRequestArguments,
	): void {
		response.body = response.body || {};
		response.body.supportsRestartRequest = true;
		super.initializeRequest(response, args);
	}

	protected async launchRequest(response: DebugProtocol.LaunchResponse, args: FlutterLaunchRequestArguments): Promise<void> {
		this.flutterCapabilities.version = getSdkVersion(this.logger, { sdkRoot: args.flutterSdkPath }) ?? this.flutterCapabilities.version;
		this.flutterTrackWidgetCreation = args && args.flutterTrackWidgetCreation !== false;

		await super.launchRequest(response, args);
	}

	protected async attachRequest(response: DebugProtocol.AttachResponse, args: FlutterAttachRequestArguments): Promise<void> {
		// For flutter attach, we actually do the same thing as launch - we run a flutter process
		// (flutter attach instead of flutter run).
		this.subscribeToStdout = true;
		return this.launchRequest(response, args);
	}

	protected async spawnProcess(args: FlutterLaunchRequestArguments): Promise<SpawnedProcess> {
		const isAttach = args.request === "attach";

		if (args.showMemoryUsage) {
			this.pollforMemoryMs = 1000;
		}

		// If we have a service info file, read the URI from it and then use that
		// as if it was supplied.
		if (isAttach && (!args.vmServiceUri && args.serviceInfoFile)) {
			this.vmServiceInfoFile = args.serviceInfoFile;
			this.updateProgress(debugLaunchProgressId, `Waiting for ${this.vmServiceInfoFile}`);
			args.vmServiceUri = await this.startServiceFilePolling();
		}

		// Normally for `flutter run` we don't allow terminating the pid we get from the VM service,
		// because it's on a remote device, however in the case of the flutter-tester, it is local
		// and otherwise might be left hanging around.
		// Unless, of course, we attached in which case we expect to detach by default.
		this.allowTerminatingVmServicePid = args.deviceId === "flutter-tester" && !isAttach;

		const logger = new DebugAdapterLogger(this, this.logCategory);
		this.expectAdditionalPidToTerminate = true;
		this.runDaemon = this.spawnRunDaemon(isAttach, args, logger);
		this.runDaemon.registerForUnhandledMessages((msg) => this.handleLogOutput(msg));

		// Set up subscriptions.
		this.runDaemon.registerForDaemonConnect((n) => this.recordAdditionalPid(n.pid));
		this.runDaemon.registerForAppStart((n) => this.currentRunningAppId = n.appId);
		this.runDaemon.registerForAppDebugPort(async (n) => {
			this.vmServiceUri = n.wsUri;
			await this.connectToVmServiceIfReady();
		});
		this.runDaemon.registerForAppStarted(async (n) => {
			this.appHasStarted = true;
			this.outputCategory = "stdout";
			await this.connectToVmServiceIfReady();
		});
		this.runDaemon.registerForAppStop((n) => {
			this.currentRunningAppId = undefined;
			if (this.runDaemon) {
				this.runDaemon.dispose();
				this.runDaemon = undefined;
			}
		});

		this.runDaemon.registerForAppProgress((e) => {
			if (!this.appHasStarted)
				this.sendLaunchProgressEvent(e);
			else
				this.sendProgressEvent(e);
		});
		this.runDaemon.registerForAppWebLaunchUrl((e) => this.sendEvent(new Event("dart.webLaunchUrl", { url: e.url, launched: e.launched })));
		// TODO: Should this use logToUser?
		this.runDaemon.registerForError((err) => this.sendEvent(new OutputEvent(`${err}\n`, "stderr")));
		this.runDaemon.registerForDaemonLog((msg) => this.handleLogOutput(msg.log, msg.error));
		this.runDaemon.registerForAppLog((msg) => this.handleLogOutput(msg.log, msg.error));

		return this.runDaemon.process!;
	}

	private sendLaunchProgressEvent(e: AppProgress) {
		// We ignore finish progress events for launch progress because we use a
		// single ID for launch progress to avoid multiple progress indicators and
		// don't want to hide the overall progress when the first step completes.
		//
		// We'll hide the overall launch progress when we connect to the VM service.
		if (!e.finished && e.message)
			this.updateProgress(debugLaunchProgressId, e.message);
	}

	private sendProgressEvent(e: AppProgress) {
		const progressID = `flutter-${e.appId}-${e.progressId}`;
		if (e.finished) {
			let finalMessage: string | undefined;
			if (!finalMessage) {
				if (e.progressId === "hot.reload")
					finalMessage = "Hot Reload complete!";
				else if (e.progressId === "hot.restart")
					finalMessage = "Hot Restart complete!";
			}
			this.endProgress(progressID, finalMessage);
		} else {
			this.startProgress(progressID, e.message);
		}
	}

	private handleLogOutput(msg: string, forceErrorCategory = false) {
		msg = `${msg.trimRight()}\n`;
		if (msg.indexOf(flutterExceptionStartBannerPrefix) !== -1) {
			// Change before logging.
			this.outputCategory = "stderr";
			this.logToUser(msg, this.outputCategory);
		} else if (msg.indexOf(flutterExceptionEndBannerPrefix) !== -1) {
			// Log before changing back.
			this.logToUser(msg, this.outputCategory);
			this.outputCategory = "stdout";
		} else {
			this.logToUser(msg, forceErrorCategory ? "stderr" : this.outputCategory);
			// This text comes through as stdout and not Progress, so map it over
			// to progress indicator.
			if (msg.indexOf("Waiting for connection from") !== -1) {
				const instructions = "Please click the Dart Debug extension button in the spawned browser window";
				this.updateProgress(debugLaunchProgressId, instructions);
				// Send this delayed, so it appears after the rest of the help text.
				setTimeout(() => this.logToUser(`${instructions}\n`, forceErrorCategory ? "stderr" : this.outputCategory), 10);
			}
		}
	}

	protected spawnRunDaemon(isAttach: boolean, args: FlutterLaunchRequestArguments, logger: Logger): RunDaemonBase {
		let appArgs = [];

		if (args.deviceId) {
			appArgs.push("-d");
			appArgs.push(args.deviceId);
		}

		if (isAttach) {
			const vmServiceUri = (args.vmServiceUri || args.observatoryUri);

			if (vmServiceUri) {
				appArgs.push("--debug-uri");
				appArgs.push(vmServiceUri);
			}
		}

		if (!isAttach) {
			if (args.flutterMode === "profile") {
				appArgs.push("--profile");
				// We also may not be able to connect a VM Service for profile modes for web.
				if (this.isWebDevice(args.deviceId) && !this.flutterCapabilities.supportsDebuggerForWebProfileBuilds) {
					this.noDebug = true;
					this.connectVmEvenForNoDebug = false;
				}
			} else if (args.flutterMode === "release") {
				appArgs.push("--release");
				// We also can't connect a VM Service for release modes.
				this.noDebug = true;
				this.connectVmEvenForNoDebug = false;
			} else {
				// Debug mode
				if (!this.flutterTrackWidgetCreation)
					appArgs.push("--no-track-widget-creation");

				if (this.useFlutterStructuredErrors && this.flutterCapabilities.supportsDartDefine)
					appArgs.push("--dart-define=flutter.inspector.structuredErrors=true");
			}

			if (args.flutterPlatform && args.flutterPlatform !== "default") {
				appArgs.push(`--target-platform=${args.flutterPlatform}`);
			}

			if (this.shouldConnectDebugger) {
				appArgs.push("--start-paused");

				if (args.vmServicePort && appArgs.indexOf("--observatory-port") === -1) {
					appArgs.push("--observatory-port");
					appArgs.push(args.vmServicePort.toString());
				}
			}

			if (this.flutterCapabilities.supportsWsVmService)
				appArgs.push("--web-server-debug-protocol", "ws");
			if (args.deviceId === "web-server") {
				if (args.debugExtensionBackendProtocol && this.flutterCapabilities.supportsWsDebugBackend)
					appArgs.push("--web-server-debug-backend-protocol", args.debugExtensionBackendProtocol);
				if (args.injectedClientProtocol && this.flutterCapabilities.supportsWsInjectedClient)
					appArgs.push("--web-server-debug-injected-client-protocol", args.injectedClientProtocol);
			}
			if (this.flutterCapabilities.supportsExposeUrl)
				appArgs.push("--web-allow-expose-url");
		}

		if (args.args) {
			appArgs = appArgs.concat(args.args);
		}

		if (args.forceFlutterVerboseMode === true && appArgs.indexOf("-v") === -1 && appArgs.indexOf("--verbose") === -1) {
			appArgs.push("-v");
		}

		if (!isAttach || args.program) {
			if (!args.workspaceConfig?.skipTargetFlag) {
				appArgs.push("--target");
			}
			appArgs.push(this.sourceFileForArgs(args));
		}

		return new FlutterRun(isAttach ? RunMode.Attach : RunMode.Run, args.flutterSdkPath, args.workspaceConfig, args.globalFlutterArgs || [], args.cwd, appArgs, { envOverrides: args.env, toolEnv: this.toolEnv }, args.flutterRunLogFile, logger, (url) => this.exposeUrl(url), this.maxLogLineLength);
	}

	private isWebDevice(deviceId: string | undefined): boolean {
		return !!(deviceId?.startsWith("web") || deviceId === "chrome" || deviceId === "edge");
	}

	private async connectToVmServiceIfReady() {
		if (this.vmServiceUri && this.appHasStarted && !this.vmService)
			await this.initDebugger(this.vmServiceUri);
	}

	protected async terminate(force: boolean): Promise<void> {
		if (!this.appHasBeenToldToStopOrDetach) {
			this.appHasBeenToldToStopOrDetach = true;
			try {
				if (this.currentRunningAppId && this.appHasStarted && !this.processExited && this.runDaemon) {
					// Request to quit/detach, but don't await it since we sometimes
					// don't get responses before the process quits.
					if (this.runDaemon.mode === RunMode.Run)
						this.runDaemon.stop(this.currentRunningAppId);
					else
						this.runDaemon.detach(this.currentRunningAppId);

					// Now wait for the process to terminate up to 3s.
					await Promise.race([
						this.processExit,
						new Promise((resolve) => setTimeout(resolve, 3000)),
					]);
				}
			} catch {
				// Ignore failures here (we're shutting down and will send kill signals).
			}
		}
		await super.terminate(force);
	}

	protected async restartRequest(
		response: DebugProtocol.RestartResponse,
		args: DebugProtocol.RestartArguments,
	): Promise<void> {
		this.sendEvent(new Event("dart.hotRestartRequest"));
		this.sendEvent(new ContinuedEvent(0, true));
		await this.performReload(true, { reason: restartReasonManual });
		super.restartRequest(response, args);
	}

	private async performReload(hotRestart: boolean, args?: { reason: string, debounce?: boolean }): Promise<any> {
		if (!this.appHasStarted || !this.currentRunningAppId || !this.runDaemon)
			return;

		if (!this.flutterCapabilities.supportsRestartDebounce && this.isReloadInProgress) {
			this.sendEvent(new OutputEvent("Reload already in progress, ignoring request", "stderr"));
			return;
		}

		this.isReloadInProgress = true;
		const restartType = hotRestart ? "hot-restart" : "hot-reload";
		try {
			await this.runDaemon.restart(this.currentRunningAppId, !this.noDebug, hotRestart, args);
		} catch (e) {
			this.sendEvent(new OutputEvent(`Error running ${restartType}: ${e}\n`, "stderr"));
		} finally {
			this.isReloadInProgress = false;
		}
	}

	protected async customRequest(request: string, response: DebugProtocol.Response, args: any): Promise<void> {
		try {
			switch (request) {
				case "serviceExtension":
					if (this.currentRunningAppId && this.runDaemon)
						await this.runDaemon.callServiceExtension(this.currentRunningAppId, args.type, args.params);
					this.sendResponse(response);
					break;

				case "checkPlatformOverride":
					if (this.currentRunningAppId && this.runDaemon) {
						const result = await this.runDaemon.callServiceExtension(this.currentRunningAppId, "ext.flutter.platformOverride", undefined);
						this.sendEvent(new Event("dart.flutter.updatePlatformOverride", { platform: result.value }));
					}
					this.sendResponse(response);
					break;

				case "checkBrightnessOverride":
					if (this.currentRunningAppId && this.runDaemon) {
						const result = await this.runDaemon.callServiceExtension(this.currentRunningAppId, "ext.flutter.brightnessOverride", undefined);
						this.sendEvent(new Event("dart.flutter.updateBrightnessOverride", { brightness: result.value }));
					}
					this.sendResponse(response);
					break;

				case "checkIsWidgetCreationTracked":
					if (this.currentRunningAppId && this.runDaemon) {
						const result = await this.runDaemon.callServiceExtension(this.currentRunningAppId, "ext.flutter.inspector.isWidgetCreationTracked", undefined);
						this.sendEvent(new Event("dart.flutter.updateIsWidgetCreationTracked", { isWidgetCreationTracked: result.result }));
					}
					this.sendResponse(response);
					break;

				case "hotReload":
					if (this.currentRunningAppId)
						await this.performReload(false, args);
					this.sendResponse(response);
					break;

				case "hotRestart":
					if (this.currentRunningAppId)
						await this.performReload(true, args);
					this.sendResponse(response);
					break;

				default:
					await super.customRequest(request, response, args);
					break;
			}
		} catch (e) {
			const error = e && e.message ? e.message : e;
			const message = `Error handling '${request}' custom request: ${error}`;

			if (!this.isTerminating)
				this.sendEvent(new OutputEvent(`${message}\n`, "stderr"));
			this.logger.error(message);
			this.errorResponse(response, message);
		}
	}

	protected async handleInspectEvent(event: VMEvent): Promise<void> {
		if (!this.runDaemon || !this.currentRunningAppId)
			return;

		const selectedWidget = await this.runDaemon.callServiceExtension(
			this.currentRunningAppId,
			"ext.flutter.inspector.getSelectedSummaryWidget",
			{ previousSelectionId: null, objectGroup: objectGroupName },
		);
		try {
			if (selectedWidget && selectedWidget.result && selectedWidget.result.creationLocation) {
				const loc = selectedWidget.result.creationLocation;
				const file = loc.file;
				const line = loc.line;
				const column = loc.column;
				this.sendEvent(new Event("dart.navigate", { file, line, column, inOtherEditorColumn: true }));
			} else {
				await super.handleInspectEvent(event);
			}
		} finally {
			// console.log(JSON.stringify(selectedWidget));
			await this.runDaemon.callServiceExtension(
				this.currentRunningAppId,
				"ext.flutter.inspector.disposeGroup",
				{ objectGroup: objectGroupName },
			);
			// TODO: How can we translate this back to source?
			// const evt = event as any;
			// const thread: VMIsolateRef = evt.isolate;
			// const inspectee = (event as any).inspectee;
		}
	}

	private handleFlutterErrorEvent(event: VMEvent) {
		const error = event.extensionData as FlutterErrorData;
		this.logFlutterErrorToUser(error);

		if (this.useInspectorNotificationsForWidgetErrors)
			this.tryParseDevToolsInspectLink(error);
	}

	private logFlutterErrorToUser(error: FlutterErrorData) {
		const assumedTerminalSize = 80;
		const barChar = "═";
		const headerPrefix = barChar.repeat(8);
		const headerSuffix = barChar.repeat(Math.max((assumedTerminalSize - error.description.length - 2 - headerPrefix.length), 0));
		const header = `${headerPrefix} ${error.description} ${headerSuffix}`;
		this.logToUser(`\n`, "stderr");
		this.logToUser(`${header}\n`, "stderr");
		if (error.errorsSinceReload)
			this.logFlutterErrorSummary(error);
		else
			this.logDiagnosticNodeDescendents(error);
		this.logToUser(`${barChar.repeat(header.length)}\n`, "stderr");
	}

	private logDiagnosticNodeToUser(node: DiagnosticsNode, { parent, level = 0, blankLineAfterSummary = true }: { parent: DiagnosticsNode; level?: number; blankLineAfterSummary?: boolean }) {
		if (node.description && node.description.startsWith("◢◤◢◤◢◤◢◤◢◤◢◤◢◤◢◤◢◤◢◤◢◤◢◤◢◤◢◤◢◤◢◤◢◤◢◤◢◤"))
			return;

		if (node.type === DiagnosticsNodeType.ErrorSpacer)
			return;

		let line = " ".repeat(level * 4);
		if (node.name && node.showName !== false) {
			line += node.name;
			if (node.showSeparator !== false && node.description)
				line += ": ";
		}
		if (node.description) {
			if (this.useInspectorNotificationsForWidgetErrors && node.type === DiagnosticsNodeType.DevToolsDeepLinkProperty)
				line += "You can inspect this widget using the 'Inspect Widget' button in the VS Code notification.";
			else
				line += node.description;
		}
		line = line.trimRight();

		// For text that is not part of a stack trace and is not an Error or Summary we
		// want to override the default red text for the stderr category to grey.
		const isErrorMessage = node.level === DiagnosticsNodeLevel.Error
			|| node.level === DiagnosticsNodeLevel.Summary
			// TODO: Remove this when Flutter is marking user-thrown exceptions with
			// ErrorSummary.
			|| node.description && node.description.startsWith("Exception: ");

		if (isErrorMessage) {
			this.logToUser(`${line}\n`, "stderr");
		} else {
			this.logToUser(`${line}\n`, "stdout");
		}
		if (blankLineAfterSummary && node.level === DiagnosticsNodeLevel.Summary)
			this.logToUser("\n", "stdout");

		const childLevel = node.style === DiagnosticsNodeStyle.Flat
			? level
			: level + 1;

		this.logDiagnosticNodeDescendents(node, childLevel);
	}

	private logFlutterErrorSummary(error: FlutterErrorData) {
		for (const p of error.properties) {
			const allChildrenAreLeaf = p.children && p.children.length && !p.children.find((c) => c.children && c.children.length);
			if (p.level === DiagnosticsNodeLevel.Summary || allChildrenAreLeaf)
				this.logDiagnosticNodeToUser(p, { parent: error, blankLineAfterSummary: false });
		}
	}

	private logDiagnosticNodeDescendents(node: DiagnosticsNode, level: number = 0) {
		if (node.style === DiagnosticsNodeStyle.Shallow)
			return;

		if (node.properties) {
			let lastLevel: DiagnosticsNodeLevel | undefined;
			for (const child of node.properties) {
				if (lastLevel !== child.level && (lastLevel === DiagnosticsNodeLevel.Hint || child.level === DiagnosticsNodeLevel.Hint))
					this.logToUser("\n", "stdout");
				this.logDiagnosticNodeToUser(child, { parent: node, level });
				lastLevel = child.level;
			}
		}
		if (node.children)
			node.children.forEach((child) => this.logDiagnosticNodeToUser(child, { parent: node, level }));
	}

	static flutterErrorDevToolsUrlPattern = new RegExp("(https?://[^/]+/)[^ ]+&inspectorRef=([^ &\\n]+)");
	private tryParseDevToolsInspectLink(error: FlutterErrorData) {
		try {
			const errorSummaryNode = error.properties?.find((p) => p.type === DiagnosticsNodeType.ErrorSummary);
			const devToolsLinkNode = error.properties?.find((p) => p.type === DiagnosticsNodeType.DevToolsDeepLinkProperty);

			// "A RenderFlex overflowed by 5551 pixels on the right."
			const errorDescription = errorSummaryNode?.description;

			// "http://127.0.0.1:9100/#/inspector?uri=http%3A%2F%2F127.0.0.1%3A49905%2FC-UKCEA9hEQ%3D%2F&inspectorRef=inspector-0"
			const devToolsInspectWidgetUrl = devToolsLinkNode?.value;
			const devToolsInspectWidgetUrlMatch = devToolsInspectWidgetUrl ? FlutterDebugSession.flutterErrorDevToolsUrlPattern.exec(devToolsInspectWidgetUrl) : undefined;
			const devToolsUrl = devToolsInspectWidgetUrlMatch?.length ? devToolsInspectWidgetUrlMatch[1] : undefined;
			const inspectorReference = devToolsInspectWidgetUrlMatch?.length ? devToolsInspectWidgetUrlMatch[2] : undefined;

			if (errorDescription && devToolsUrl && inspectorReference) {
				this.sendEvent(new Event("dart.flutter.widgetErrorInspectData", { errorDescription, devToolsUrl, inspectorReference } as WidgetErrorInspectData));
			}
		} catch (e) {
			this.logger.error(`Error trying to parse widget inspect data from structured error`);
		}
	}

	// Extension
	public async handleExtensionEvent(event: VMEvent) {
		// Don't process any events while the debugger is still running init code.
		await this.debuggerInit;

		if (event.kind === "Extension" && event.extensionKind === "Flutter.FirstFrame") {
			this.sendEvent(new Event("dart.flutter.firstFrame", {}));
		} else if (event.kind === "Extension" && event.extensionKind === "Flutter.Error") {
			this.handleFlutterErrorEvent(event);
		} else if (event.kind === "Extension" && event.extensionKind === "Flutter.ServiceExtensionStateChanged") {
			this.sendEvent(new Event("dart.flutter.serviceExtensionStateChanged", event.extensionData));
		} else {
			super.handleExtensionEvent(event);
		}
	}

	public handleServiceExtensionAdded(event: VMEvent) {
		super.handleServiceExtensionAdded(event);

		if (!this.runDaemon || !this.currentRunningAppId)
			return;

		if (event.extensionRPC === VmServiceExtension.InspectorStructuredErrors && this.useFlutterStructuredErrors) {
			this.runDaemon.callServiceExtension(this.currentRunningAppId, event.extensionRPC, { enabled: true })
				.catch((e) => this.logger.error(e));
		}
	}
}
