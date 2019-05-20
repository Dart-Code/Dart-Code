import { Event, OutputEvent } from "vscode-debugadapter";
import { DebugProtocol } from "vscode-debugprotocol";
import { restartReasonManual } from "../constants";
import { logWarn } from "../utils/log";
import { extractObservatoryPort } from "../utils/vscode/debug";
import { DartDebugSession } from "./dart_debug_impl";
import { VMEvent } from "./dart_debug_protocol";
import { FlutterRun } from "./flutter_run";
import { FlutterRunBase, RunMode } from "./flutter_run_base";
import { FlutterAttachRequestArguments, FlutterLaunchRequestArguments, LogCategory, LogMessage, LogSeverity } from "./utils";

const objectGroupName = "my-group";
const flutterExceptionStartBannerPrefix = "══╡ EXCEPTION CAUGHT BY";
const flutterExceptionEndBannerPrefix = "══════════════════════════════════════════";

export class FlutterDebugSession extends DartDebugSession {
	private flutter?: FlutterRunBase;
	public flutterTrackWidgetCreation: boolean;
	private currentRunningAppId?: string;
	private appHasStarted = false;
	private observatoryUri?: string;
	private isReloadInProgress = false;

	// Allow flipping into stderr mode for red exceptions when we see the start/end of a Flutter exception dump.
	private outputCategory: "stdout" | "stderr" = "stdout";

	constructor() {
		super();

		this.sendStdOutToConsole = false;
		// We get the Observatory URI from the `flutter run` process. If we parse
		// it out of verbose logging and connect to it, it'll be before Flutter is
		// finished setting up and bad things can happen (like us sending events
		// way too early).
		this.parseObservatoryUriFromStdOut = false;
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
		response.body.supportsRestartRequest = true;
		super.initializeRequest(response, args);
	}

	protected launchRequest(response: DebugProtocol.LaunchResponse, args: FlutterLaunchRequestArguments): void {
		this.flutterTrackWidgetCreation = args && args.flutterTrackWidgetCreation;
		this.outputCategory = "stdout";
		return super.launchRequest(response, args);
	}

	protected async attachRequest(response: DebugProtocol.AttachResponse, args: any): Promise<void> {
		// For flutter attach, we actually do the same thing as launch - we run a flutter process
		// (flutter attach instead of flutter run).
		// this.observatoryUriIsProbablyReconnectable = true;
		this.launchRequest(response, args);
	}

	protected spawnProcess(args: FlutterLaunchRequestArguments): any {
		const isAttach = args.request === "attach";
		if (isAttach)
			this.sendEvent(new Event("dart.launching", { message: "Waiting for Application to connect...", finished: false }));
		else
			this.sendEvent(new Event("dart.launching", { message: "Launching...", finished: false }));

		if (args.showMemoryUsage) {
			this.pollforMemoryMs = 1000;
		}

		// Normally for `flutter run` we don't allow terminating the pid we get from Observatory,
		// because it's on a remote device, however in the case of the flutter-tester, it is local
		// and otherwise might be left hanging around.
		// Unless, of course, we attached in which case we expect to detach by default.
		this.allowTerminatingObservatoryVmPid = args.deviceId === "flutter-tester" && !isAttach;

		const logger = (message: string, severity: LogSeverity) => this.sendEvent(new Event("dart.log", new LogMessage(message, severity, this.logCategory)));
		this.flutter = this.spawnRunDaemon(isAttach, args, logger);
		this.flutter.registerForUnhandledMessages((msg) => this.handleLogOutput(msg));

		// Set up subscriptions.
		this.flutter.registerForDaemonConnect((n) => this.additionalPidsToTerminate.push(n.pid));
		this.flutter.registerForAppStart((n) => this.currentRunningAppId = n.appId);
		this.flutter.registerForAppDebugPort((n) => {
			this.observatoryUri = n.wsUri;
			this.connectToObservatoryIfReady();
		});
		this.flutter.registerForAppStarted((n) => {
			this.appHasStarted = true;
			this.connectToObservatoryIfReady();
			this.sendEvent(new Event("dart.launched"));
		});
		this.flutter.registerForAppStop((n) => { this.currentRunningAppId = undefined; this.flutter.dispose(); });
		this.flutter.registerForAppProgress((e) => this.sendEvent(new Event("dart.progress", { message: e.message, finished: e.finished, progressID: e.progressId || e.id })));
		// TODO: Should this use logToUser?
		this.flutter.registerForError((err) => this.sendEvent(new OutputEvent(`${err}\n`, "stderr")));
		this.flutter.registerForDaemonLog((msg) => this.handleLogOutput(msg.log, msg.error));
		this.flutter.registerForAppLog((msg) => this.handleLogOutput(msg.log, msg.error));

		return this.flutter.process;
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
		}
	}

	protected spawnRunDaemon(isAttach: boolean, args: FlutterLaunchRequestArguments, logger: (message: string, severity: LogSeverity) => void): FlutterRunBase {
		let appArgs = [];
		if (!isAttach) {
			appArgs.push("-t");
			appArgs.push(this.sourceFileForArgs(args));
		}

		if (args.deviceId) {
			appArgs.push("-d");
			appArgs.push(args.deviceId);
		}

		if (isAttach) {
			const flutterAttach: FlutterAttachRequestArguments = args as any;
			if (flutterAttach.observatoryUri) {
				if (args.flutterAttachSupportsUris) {
					appArgs.push("--debug-uri");
					appArgs.push(flutterAttach.observatoryUri);
				} else {
					const observatoryPort = extractObservatoryPort(flutterAttach.observatoryUri);
					if (observatoryPort) {
						appArgs.push("--debug-port");
						appArgs.push(observatoryPort.toString());
					} else {
						logWarn(`Observatory port was not found: ${flutterAttach.observatoryUri}`);
					}
				}
			}
		}

		if (!isAttach) {
			if (args.flutterMode === "profile") {
				appArgs.push("--profile");
			} else if (args.flutterMode === "release") {
				appArgs.push("--release");
			} else {
				// Debug mode
				if (this.flutterTrackWidgetCreation) {
					appArgs.push("--track-widget-creation");
				}
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
		}

		if (args.args) {
			appArgs = appArgs.concat(args.args);
		}

		if (args.forceFlutterVerboseMode === true && appArgs.indexOf("-v") === -1 && appArgs.indexOf("--verbose") === -1) {
			appArgs.push("-v");
		}

		return new FlutterRun(isAttach ? RunMode.Attach : RunMode.Run, args.flutterPath, args.cwd, appArgs, args.env, args.flutterRunLogFile, logger, this.maxLogLineLength);
	}

	private connectToObservatoryIfReady() {
		if (this.observatoryUri && this.appHasStarted && !this.observatory)
			this.initDebugger(this.observatoryUri);
	}

	protected async terminate(force: boolean): Promise<void> {
		try {
			if (this.currentRunningAppId && this.appHasStarted && !this.processExited) {
				const quitMethod = this.flutter.mode === RunMode.Run
					? () => this.flutter.stop(this.currentRunningAppId)
					: () => this.flutter.detach(this.currentRunningAppId);
				// Wait up to 1000ms for app to quit since we often don't get a
				// response here because the processes terminate immediately.
				await Promise.race([
					quitMethod(),
					new Promise((resolve) => setTimeout(resolve, 1000)),
				]);
			}
		} catch {
			// Ignore failures here (we're shutting down and will send kill signals).
		}
		super.terminate(force);
	}

	protected restartRequest(
		response: DebugProtocol.RestartResponse,
		args: DebugProtocol.RestartArguments,
	): void {
		this.sendEvent(new Event("dart.hotRestartRequest"));
		this.performReload(true, restartReasonManual);
		super.restartRequest(response, args);
	}

	private async performReload(hotRestart: boolean, reason: string): Promise<any> {
		if (!this.appHasStarted)
			return;

		if (this.isReloadInProgress) {
			this.sendEvent(new OutputEvent("Reload already in progress, ignoring request", "stderr"));
			return;
		}
		this.isReloadInProgress = true;
		const restartType = hotRestart ? "hot-restart" : "hot-reload";
		try {
			await this.flutter.restart(this.currentRunningAppId, !this.noDebug, hotRestart, reason);
			this.requestCoverageUpdate(restartType);
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
					if (this.currentRunningAppId)
						await this.flutter.callServiceExtension(this.currentRunningAppId, args.type, args.params);
					this.sendResponse(response);
					break;

				case "checkPlatformOverride":
					if (this.currentRunningAppId) {
						const result = await this.flutter.callServiceExtension(this.currentRunningAppId, "ext.flutter.platformOverride", undefined);
						this.sendEvent(new Event("dart.flutter.updatePlatformOverride", { platform: result.value }));
					}
					this.sendResponse(response);
					break;

				case "checkIsWidgetCreationTracked":
					if (this.currentRunningAppId) {
						const result = await this.flutter.callServiceExtension(this.currentRunningAppId, "ext.flutter.inspector.isWidgetCreationTracked", undefined);
						this.sendEvent(new Event("dart.flutter.updateIsWidgetCreationTracked", { isWidgetCreationTracked: result.result }));
					}
					this.sendResponse(response);
					break;

				case "hotReload":
					if (this.currentRunningAppId)
						await this.performReload(false, args && args.reason || restartReasonManual);
					this.sendResponse(response);
					break;

				case "hotRestart":
					if (this.currentRunningAppId)
						await this.performReload(true, args && args.reason || restartReasonManual);
					this.sendResponse(response);
					break;

				default:
					super.customRequest(request, response, args);
					break;
			}
		} catch (e) {
			this.sendEvent(new OutputEvent(`${e}\n`, "stderr"));
		}
	}

	protected async handleInspectEvent(event: VMEvent): Promise<void> {
		const selectedWidget = await this.flutter.callServiceExtension(
			this.currentRunningAppId,
			"ext.flutter.inspector.getSelectedSummaryWidget",
			{ previousSelectionId: null, objectGroup: objectGroupName },
		);
		if (selectedWidget && selectedWidget.result && selectedWidget.result.creationLocation) {
			const loc = selectedWidget.result.creationLocation;
			const file = loc.file;
			const line = loc.line;
			const column = loc.column;
			this.sendEvent(new Event("dart.navigate", { file, line, column }));
		}
		// console.log(JSON.stringify(selectedWidget));
		await this.flutter.callServiceExtension(
			this.currentRunningAppId,
			"ext.flutter.inspector.disposeGroup",
			{ objectGroup: objectGroupName },
		);
		// TODO: How can we translate this back to source?
		// const evt = event as any;
		// const thread: VMIsolateRef = evt.isolate;
		// const inspectee = (event as any).inspectee;
	}

	// Extension
	public handleExtensionEvent(event: VMEvent) {
		if (event.kind === "Extension" && event.extensionKind === "Flutter.FirstFrame") {
			this.sendEvent(new Event("dart.flutter.firstFrame", {}));
		} else if (event.kind === "Extension" && event.extensionKind === "Flutter.Frame") {
			this.requestCoverageUpdate("frame");
		} else if (event.kind === "Extension" && event.extensionKind === "Flutter.ServiceExtensionStateChanged") {
			this.sendEvent(new Event("dart.flutter.serviceExtensionStateChanged", event.extensionData));
		} else {
			super.handleExtensionEvent(event);
		}
	}
}
