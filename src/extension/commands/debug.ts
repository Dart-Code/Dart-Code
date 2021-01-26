import * as fs from "fs";
import * as path from "path";
import * as vs from "vscode";
import { devToolsPages, doNotAskAgainAction, isInFlutterDebugModeDebugSessionContext, isInFlutterProfileModeDebugSessionContext, widgetInspectorPage } from "../../shared/constants";
import { DebuggerType, DebugOption, debugOptionNames, LogSeverity, VmServiceExtension } from "../../shared/enums";
import { DartWorkspaceContext, DevToolsPage, Logger, LogMessage, WidgetErrorInspectData } from "../../shared/interfaces";
import { flatMap, PromiseCompleter } from "../../shared/utils";
import { findProjectFolders, fsPath } from "../../shared/utils/fs";
import { showDevToolsNotificationIfAppropriate } from "../../shared/vscode/user_prompts";
import { envUtils, getDartWorkspaceFolders } from "../../shared/vscode/utils";
import { Context } from "../../shared/vscode/workspace";
import { Analytics } from "../analytics";
import { config } from "../config";
import { ServiceExtensionArgs, timeDilationNormal, timeDilationSlow, VmServiceExtensions } from "../flutter/vm_service_extensions";
import { PubGlobal } from "../pub/global";
import { DevToolsManager } from "../sdk/dev_tools/manager";
import { getExcludedFolders, isValidEntryFile } from "../utils";
import { DartDebugSessionInformation, ProgressMessage } from "../utils/vscode/debug";

export const debugSessions: DartDebugSessionInformation[] = [];
const CURRENT_FILE_RUNNABLE = "dart-code:currentFileIsRunnable";

// Workaround for https://github.com/microsoft/vscode/issues/100115
const dynamicDebugSessionName = "Dart ";

// As a workaround for https://github.com/Microsoft/vscode/issues/71651 we
// will keep any events that arrive before their session "started" and then
// replace them when the start event comes through.
let pendingCustomEvents: vs.DebugSessionCustomEvent[] = [];

let hasPromptedAboutDebugSettings = false;

export class LastDebugSession {
	public static workspaceFolder?: vs.WorkspaceFolder;
	public static debugConfig?: vs.DebugConfiguration;
}

export class LastTestDebugSession {
	public static workspaceFolder?: vs.WorkspaceFolder;
	public static debugConfig?: vs.DebugConfiguration;
}

export class DebugCommands {
	private debugOptions = vs.window.createStatusBarItem(vs.StatusBarAlignment.Left, 0);
	private currentDebugOption = DebugOption.MyCode;
	private debugMetrics = vs.window.createStatusBarItem(vs.StatusBarAlignment.Right, 0);
	private onWillHotReloadEmitter = new vs.EventEmitter<void>();
	public readonly onWillHotReload = this.onWillHotReloadEmitter.event;
	private onWillHotRestartEmitter = new vs.EventEmitter<void>();
	public readonly onWillHotRestart = this.onWillHotRestartEmitter.event;
	private onFirstFrameEmitter = new vs.EventEmitter<void>();
	public readonly onFirstFrame = this.onFirstFrameEmitter.event;
	private onDebugSessionVmServiceAvailableEmitter = new vs.EventEmitter<DartDebugSessionInformation>();
	public readonly onDebugSessionVmServiceAvailable = this.onDebugSessionVmServiceAvailableEmitter.event;
	public readonly vmServices: VmServiceExtensions;
	public readonly devTools: DevToolsManager;
	private suppressFlutterWidgetErrors = false;

	constructor(private readonly logger: Logger, private context: Context, workspaceContext: DartWorkspaceContext, private readonly analytics: Analytics, pubGlobal: PubGlobal) {
		this.vmServices = new VmServiceExtensions(logger, this.sendServiceSetting);
		this.devTools = new DevToolsManager(logger, workspaceContext, this, analytics, pubGlobal);
		context.subscriptions.push(this.devTools);
		context.subscriptions.push(this.debugOptions);
		context.subscriptions.push(this.debugMetrics);

		context.subscriptions.push(vs.debug.onDidChangeBreakpoints((e) => this.handleBreakpointChange(e)));
		context.subscriptions.push(vs.debug.onDidStartDebugSession((s) => this.handleDebugSessionStart(s)));
		context.subscriptions.push(vs.debug.onDidReceiveDebugSessionCustomEvent((e) => this.handleDebugSessionCustomEvent(e)));
		context.subscriptions.push(vs.debug.onDidTerminateDebugSession((s) => this.handleDebugSessionEnd(s)));
		context.subscriptions.push(vs.window.onDidChangeActiveTextEditor((e) => this.updateEditorContexts(e)));
		// Run for current open editor.
		this.updateEditorContexts(vs.window.activeTextEditor);

		context.subscriptions.push(vs.commands.registerCommand("flutter.togglePlatform", () => this.vmServices.toggle(VmServiceExtension.PlatformOverride, "iOS", "android")));
		context.subscriptions.push(vs.commands.registerCommand("flutter.toggleDebugPainting", () => this.vmServices.toggle(VmServiceExtension.DebugPaint)));
		context.subscriptions.push(vs.commands.registerCommand("flutter.togglePerformanceOverlay", () => this.vmServices.toggle(VmServiceExtension.PerformanceOverlay)));
		context.subscriptions.push(vs.commands.registerCommand("flutter.toggleBrightness", () => this.vmServices.toggle(VmServiceExtension.BrightnessOverride, "Brightness.dark", "Brightness.light")));
		context.subscriptions.push(vs.commands.registerCommand("flutter.toggleRepaintRainbow", () => this.vmServices.toggle(VmServiceExtension.RepaintRainbow)));
		context.subscriptions.push(vs.commands.registerCommand("flutter.toggleDebugModeBanner", () => this.vmServices.toggle(VmServiceExtension.DebugBanner)));
		context.subscriptions.push(vs.commands.registerCommand("flutter.toggleCheckElevations", () => this.vmServices.toggle(VmServiceExtension.CheckElevations)));
		context.subscriptions.push(vs.commands.registerCommand("flutter.togglePaintBaselines", () => this.vmServices.toggle(VmServiceExtension.PaintBaselines)));
		context.subscriptions.push(vs.commands.registerCommand("flutter.toggleSlowAnimations", () => this.vmServices.toggle(VmServiceExtension.SlowAnimations, timeDilationNormal, timeDilationSlow)));
		context.subscriptions.push(vs.commands.registerCommand("flutter.inspectWidget", () => this.vmServices.toggle(VmServiceExtension.InspectorSelectMode, true, true)));
		context.subscriptions.push(vs.commands.registerCommand("flutter.cancelInspectWidget", () => this.vmServices.toggle(VmServiceExtension.InspectorSelectMode, false, false)));

		context.subscriptions.push(vs.commands.registerCommand("dart.openObservatory", async () => {
			const session = await this.getDebugSession();
			if (session && !session.session.configuration.noDebug && session.observatoryUri) {
				await envUtils.openInBrowser(session.observatoryUri);
				analytics.logDebuggerOpenObservatory();
			} else if (session) {
				logger.warn("Cannot start Observatory for session without debug/observatoryUri");
			}
		}));
		context.subscriptions.push(vs.commands.registerCommand("flutter.openTimeline", async () => {
			const session = await this.getDebugSession();
			if (session && !session.session.configuration.noDebug && session.observatoryUri) {
				await envUtils.openInBrowser(session.observatoryUri + "/#/timeline-dashboard");
				analytics.logDebuggerOpenTimeline();
			} else if (session) {
				logger.warn("Cannot start Observatory for session without debug/observatoryUri");
			}
		}));
		context.subscriptions.push(vs.commands.registerCommand("_dart.openDevTools.touchBar", () => vs.commands.executeCommand("dart.openDevTools")));
		devToolsPages.forEach((page) => {
			context.subscriptions.push(vs.commands.registerCommand(page.commandId, async (options?: { debugSessionId?: string, triggeredAutomatically?: boolean }): Promise<{ url: string, dispose: () => void } | undefined> => {
				options = Object.assign({}, options, { page });
				return vs.commands.executeCommand("dart.openDevTools", options);
			}));
		});
		context.subscriptions.push(vs.commands.registerCommand("flutter.openDevTools", async (options?: { debugSessionId?: string, triggeredAutomatically?: boolean, page?: DevToolsPage }): Promise<{ url: string, dispose: () => void } | undefined> =>
			vs.commands.executeCommand("dart.openDevTools", options)));
		context.subscriptions.push(vs.commands.registerCommand("dart.openDevTools", async (options?: { debugSessionId?: string, triggeredAutomatically?: boolean, page?: DevToolsPage }): Promise<{ url: string, dispose: () => void } | undefined> => {
			if (!debugSessions.length)
				return this.devTools.spawnForNoSession();

			const session = options && options.debugSessionId
				? debugSessions.find((s) => s.session.id === options.debugSessionId)
				: await this.getDebugSession();
			if (!session)
				return; // User cancelled or specified session was gone

			// Only show a notification if we were not triggered automatically.
			const notify = !options || options.triggeredAutomatically !== true;
			const page = options?.page;

			if (session.vmServiceUri) {
				return this.devTools.spawnForSession(session as DartDebugSessionInformation & { vmServiceUri: string }, { notify, page });
			} else if (session.session.configuration.noDebug) {
				vs.window.showInformationMessage("You must start your app with debugging in order to use DevTools.");
			} else {
				vs.window.showInformationMessage("This debug session is not ready yet.");
			}
		}));

		// Misc custom debug commands.
		context.subscriptions.push(vs.commands.registerCommand("_flutter.hotReload.touchBar", (args: any) => vs.commands.executeCommand("flutter.hotReload", args)));
		context.subscriptions.push(vs.commands.registerCommand("flutter.hotReload", (args?: any) => {
			if (!debugSessions.length)
				return;
			this.onWillHotReloadEmitter.fire();
			debugSessions.forEach((s) => s.session.customRequest("hotReload", args));
			analytics.logDebuggerHotReload();
		}));
		context.subscriptions.push(vs.commands.registerCommand("flutter.hotRestart", (args?: any) => {
			if (!debugSessions.length)
				return;
			this.onWillHotRestartEmitter.fire();
			debugSessions.forEach((s) => s.session.customRequest("hotRestart", args));
			analytics.logDebuggerRestart();
		}));
		context.subscriptions.push(vs.commands.registerCommand("dart.startDebugging", (resource: vs.Uri, launchTemplate: any | undefined) => {
			const launchConfig = Object.assign(
				{
					name: dynamicDebugSessionName,
					noDebug: false,
					request: "launch",
					type: "dart",
				},
				launchTemplate,
				{
					program: fsPath(resource),
				},
			);
			vs.debug.startDebugging(vs.workspace.getWorkspaceFolder(resource), launchConfig);
		}));
		context.subscriptions.push(vs.commands.registerCommand("dart.startWithoutDebugging", (resource: vs.Uri, launchTemplate: any | undefined) => {
			const launchConfig = Object.assign(
				{
					name: dynamicDebugSessionName,
					noDebug: true,
					request: "launch",
					type: "dart",
				},
				launchTemplate,
				{
					program: fsPath(resource),
				},
			);
			vs.debug.startDebugging(vs.workspace.getWorkspaceFolder(resource), launchConfig);
		}));
		context.subscriptions.push(vs.commands.registerCommand("dart.runAllTestsWithoutDebugging", async () => {
			const workspaceFolders = getDartWorkspaceFolders();
			const topLevelFolders = workspaceFolders.map((w) => fsPath(w.uri));
			const allExcludedFolders = flatMap(workspaceFolders, getExcludedFolders);
			const testFolders = (await findProjectFolders(this.logger, topLevelFolders, allExcludedFolders, { requirePubspec: true }))
				.map((project) => path.join(project, "test"))
				.filter((testFolder) => fs.existsSync(testFolder));
			if (testFolders.length === 0) {
				vs.window.showErrorMessage("Unable to find any test folders");
				return;
			}
			for (const folder of testFolders) {
				const ws = vs.workspace.getWorkspaceFolder(vs.Uri.file(folder));
				const name = path.basename(path.dirname(folder));
				vs.debug.startDebugging(ws, {
					name: `${name} tests`,
					noDebug: true,
					// To run all tests, we set `program` to a test folder.
					program: folder,
					request: "launch",
					type: "dart",
				});
			}
		}));
		context.subscriptions.push(vs.commands.registerCommand("dart.rerunLastDebugSession", () => {
			if (LastDebugSession.debugConfig) {
				vs.debug.startDebugging(LastDebugSession.workspaceFolder, LastDebugSession.debugConfig);
			} else {
				vs.window.showErrorMessage("There is no previous debug session to run.");
			}
		}));
		context.subscriptions.push(vs.commands.registerCommand("dart.rerunLastTestDebugSession", () => {
			if (LastTestDebugSession.debugConfig) {
				vs.debug.startDebugging(LastTestDebugSession.workspaceFolder, LastTestDebugSession.debugConfig);
			} else {
				vs.window.showErrorMessage("There is no previous test session to run.");
			}
		}));

		// Attach commands.
		context.subscriptions.push(vs.commands.registerCommand("dart.attach", () => {
			vs.debug.startDebugging(undefined, {
				name: "Dart: Attach to Process",
				request: "attach",
				type: "dart",
			});
		}));
		context.subscriptions.push(vs.commands.registerCommand("flutter.attachProcess", () => {
			vs.debug.startDebugging(undefined, {
				name: "Flutter: Attach to Process",
				request: "attach",
				type: "dart",
				vmServiceUri: "${command:dart.promptForVmService}",
			});
		}));
		context.subscriptions.push(vs.commands.registerCommand("flutter.attach", () => {
			vs.debug.startDebugging(undefined, {
				name: "Flutter: Attach to Device",
				request: "attach",
				type: "dart",
			});
		}));
		context.subscriptions.push(vs.commands.registerCommand("dart.promptForVmService", async (defaultValueOrConfig: string | vs.DebugConfiguration | undefined): Promise<string | undefined> => {
			const defaultValue = typeof defaultValueOrConfig === "string" ? defaultValueOrConfig : undefined;
			return vs.window.showInputBox({
				ignoreFocusOut: true, // Don't close the window if the user tabs away to get the uri
				placeHolder: "Paste an VM Service URI",
				prompt: "Enter VM Service URI",
				validateInput: (input) => {
					if (!input)
						return;

					input = input.trim();

					// eslint-disable-next-line id-blacklist
					if (Number.isInteger(parseFloat(input)))
						return;

					// Uri.parse doesn't seem to work as expected, so do our own basic validation
					// https://github.com/Microsoft/vscode/issues/49818

					if (!input.startsWith("http://") && !input.startsWith("https://")
						&& !input.startsWith("ws://") && !input.startsWith("wss://"))
						return "Please enter a valid VM Service URI";
				},
				value: defaultValue,
			});
		}));

		// Debug options.
		if (config.debugSdkLibraries && config.debugExternalLibraries)
			this.currentDebugOption = DebugOption.MyCodePackagesSdk;
		else if (config.debugSdkLibraries)
			this.currentDebugOption = DebugOption.MyCodeSdk;
		else if (config.debugExternalLibraries)
			this.currentDebugOption = DebugOption.MyCodePackages;
		context.subscriptions.push(vs.commands.registerCommand("_dart.toggleDebugOptions", this.toggleDebugOptions, this));
		this.debugOptions.text = `Debug ${debugOptionNames[this.currentDebugOption]}`;
		this.debugOptions.tooltip = `Controls whether to step into or stop at breakpoints in only files in this workspace or also those in SDK and/or external Pub packages`;
		this.debugOptions.command = "_dart.toggleDebugOptions";
	}

	private async getDebugSession(): Promise<DartDebugSessionInformation | undefined> {
		if (debugSessions.length === 0) {
			this.logger.info("No debug session to use!");
			return undefined;
		} else if (debugSessions.length === 1) {
			this.logger.info("Using only available debug session");
			return debugSessions[0];
		} else {
			this.logger.info("Multiple debug sessions available, prompting user");
			const selectedItem = await vs.window.showQuickPick(
				debugSessions.map((s) => ({
					description: s.session.workspaceFolder ? s.session.workspaceFolder.name : undefined,
					detail: s.session.configuration.deviceName || `Started ${s.sessionStart.toLocaleTimeString()}`,
					label: s.session.name,
					session: s,
				})),
				{
					placeHolder: "Which debug session?",
				},
			);

			return selectedItem && selectedItem.session;
		}
	}

	public handleBreakpointChange(e: vs.BreakpointsChangeEvent): void {
		if (hasPromptedAboutDebugSettings)
			return;

		for (const bp of e.added)
			this.promptAboutDebuggerSettingsIfBreakpointOutsideWorkspace(bp);
	}

	public promptAboutDebuggerSettingsIfBreakpointOutsideWorkspace(e: vs.Breakpoint): void {
		// If the user has enabled any of these, assume they understand the setting.
		if (config.debugSdkLibraries || config.debugExternalLibraries)
			return;

		if (hasPromptedAboutDebugSettings || this.context.breakpointOutsideWorkspaceDoNotShow || !(e instanceof vs.SourceBreakpoint) || !e.enabled)
			return;

		// Don't consider non-Dart files.
		if (!fsPath(e.location.uri).toLocaleLowerCase().endsWith(".dart"))
			return;

		// If it's inside the workspace we don't want to prompt.
		if (vs.workspace.getWorkspaceFolder(e.location.uri))
			return;

		hasPromptedAboutDebugSettings = true;
		const message = `You have a breakpoint outside of your workspace but debug settings are set to 'my code'. Would you like to change settings? You can also change this from the status bar while debugging.`;

		const debugJustMyCodeAction = "Debug just my code";
		const debugEverything = "Debug my code + packages + SDK";
		vs.window.showWarningMessage(message, debugJustMyCodeAction, debugEverything, doNotAskAgainAction).then((choice) => {
			if (choice === doNotAskAgainAction)
				this.context.breakpointOutsideWorkspaceDoNotShow = true;
			if (choice !== debugEverything)
				return;

			this.currentDebugOption = DebugOption.MyCodePackagesSdk;
			this.applyNewDebugOption();
		});
	}

	public handleDebugSessionStart(s: vs.DebugSession): void {
		if (s.type !== "dart")
			return;

		const debuggerType = s.configuration ? DebuggerType[s.configuration.debuggerType] : "<unknown>";
		const session = new DartDebugSessionInformation(s, debuggerType);
		// If we're the first fresh debug session, reset all settings to default.
		// Subsequent launches will inherit the "current" values.
		if (debugSessions.length === 0)
			this.vmServices.resetToDefaults();
		debugSessions.push(session);

		if (s.configuration.debuggerType === DebuggerType.Flutter || s.configuration.debuggerType === DebuggerType.Web) {
			const mode: "debug" | "profile" | "release" = s.configuration.flutterMode;
			if (mode === "debug")
				vs.commands.executeCommand("setContext", isInFlutterDebugModeDebugSessionContext, true);
			if (mode === "profile")
				vs.commands.executeCommand("setContext", isInFlutterProfileModeDebugSessionContext, true);
		}

		// Process any queued events that came in before the session start
		// event.
		const eventsToProcess = pendingCustomEvents.filter((e) => e.session.id === s.id);
		pendingCustomEvents = pendingCustomEvents.filter((e) => e.session.id !== s.id);

		eventsToProcess.forEach((e) => {
			this.logger.info(`Processing delayed event ${e.event} for session ${e.session.id}`);
			// tslint:disable-next-line: no-floating-promises
			this.handleCustomEventWithSession(session, e);
		});

		this.debugOptions.show();
	}

	public handleDebugSessionCustomEvent(e: vs.DebugSessionCustomEvent): void {
		if (this.handleCustomEvent(e))
			return;

		const session = debugSessions.find((ds) => ds.session.id === e.session.id);
		if (!session) {
			this.logger.warn(`Did not find session ${e.session.id} to handle ${e.event}. There were ${debugSessions.length} sessions:\n${debugSessions.map((ds) => `  ${ds.session.id}`).join("\n")}`);
			this.logger.warn(`Event will be queued and processed when the session start event fires`);
			pendingCustomEvents.push(e);
			return;
		}
		// tslint:disable-next-line: no-floating-promises
		this.handleCustomEventWithSession(session, e);
	}

	public handleDebugSessionEnd(s: vs.DebugSession): void {
		const sessionIndex = debugSessions.findIndex((ds) => ds.session.id === s.id);
		if (sessionIndex === -1)
			return;

		// Grab the session and remove it from the list so we don't try to interact with it anymore.
		const session = debugSessions[sessionIndex];
		session.hasEnded = true;
		debugSessions.splice(sessionIndex, 1);

		// Close any in-progress progress notifications.
		for (const progressID of Object.keys(session.progress))
			session.progress[progressID]?.complete();

		const debugSessionEnd = new Date();
		this.analytics.logDebugSessionDuration(session.debuggerType, debugSessionEnd.getTime() - session.sessionStart.getTime());

		// If this was the last session terminating, then remove all the flags for which service extensions are supported.
		// Really we should track these per-session, but the changes of them being different given we only support one
		// SDK at a time are practically zero.
		if (debugSessions.length === 0) {
			this.vmServices.markAllServicesUnloaded();
			this.debugOptions.hide();
			this.debugMetrics.hide();
			for (const debugContext of [
				isInFlutterDebugModeDebugSessionContext,
				isInFlutterProfileModeDebugSessionContext,
			])
				vs.commands.executeCommand("setContext", debugContext, false);
		}
	}

	private handleCustomEvent(e: vs.DebugSessionCustomEvent): boolean {
		if (e.event === "dart.log") {
			const message: LogMessage = e.body;
			const logMessage = `[${e.session.name}] ${message.message}`;
			// TODO: Can we get rid of this switch?
			switch (message.severity) {
				case LogSeverity.Info:
					this.logger.info(logMessage, message.category);
					break;
				case LogSeverity.Warn:
					this.logger.warn(logMessage, message.category);
					break;
				case LogSeverity.Error:
					this.logger.error(logMessage, message.category);
					break;
				default:
					this.logger.warn(`Failed to handle log event [${e.session.name}] ${JSON.stringify(message)}`);
			}
		} else if (e.event === "dart.hotRestartRequest") {
			// This event comes back when the user restarts with the Restart button
			// (eg. it wasn't intiated from our extension, so we don't get to log it
			// in the command).
			this.analytics.logDebuggerRestart();
			this.onWillHotRestartEmitter.fire();
		} else if (e.event === "dart.hotReloadRequest") {
			// This event comes back when the user restarts with the Restart button
			// (eg. it wasn't intiated from our extension, so we don't get to log it
			// in the command).
			this.analytics.logDebuggerHotReload();
			this.onWillHotReloadEmitter.fire();
		} else if (e.event === "dart.flutter.firstFrame") {
			this.onFirstFrameEmitter.fire();
		} else if (e.event === "dart.debugMetrics") {
			const memory = e.body.memory;
			const message = `${Math.ceil(memory.current / 1024 / 1024)}MB of ${Math.ceil(memory.total / 1024 / 1024)}MB`;
			this.debugMetrics.text = message;
			this.debugMetrics.tooltip = "This is the amount of memory being consumed by your applications heaps (out of what has been allocated).\n\nNote: memory usage shown in debug builds may not be indicative of usage in release builds. Use profile builds for more accurate figures when testing memory usage.";
			this.debugMetrics.show();
		} else if (e.event === "dart.navigate") {
			if (e.body.file && e.body.line && e.body.column)
				vs.commands.executeCommand("_dart.jumpToLineColInUri", vs.Uri.parse(e.body.file), e.body.line, e.body.column, e.body.inOtherEditorColumn);
		} else {
			// Not handled, will fall through in the caller.
			return false;
		}
		return true;
	}

	private async handleCustomEventWithSession(session: DartDebugSessionInformation, e: vs.DebugSessionCustomEvent) {
		this.vmServices.handleDebugEvent(session, e)
			.catch((e) => this.logger.error(e));

		if (e.event === "dart.webLaunchUrl") {
			const launched = !!e.body.launched;
			if (!launched) {
				try {
					const uri = vs.Uri.parse(e.body.url, true);
					await envUtils.openInBrowser(uri.toString());
				} catch (e) {
					this.logger.error(`Failed to parse URL from Flutter app.webLaunchUrl event: ${e.body.url}`);
				}
			}
		} else if (e.event === "dart.exposeUrl") {
			const originalUrl = e.body.url as string;
			try {
				const exposedUrl = await envUtils.exposeUrl(vs.Uri.parse(originalUrl, true), this.logger);
				// HACK: Convert %24 back to $
				session.session.customRequest("exposeUrlResponse", { originalUrl, exposedUrl });
			} catch (e) {
				this.logger.error(`Failed to expose URL ${originalUrl}: ${e}`);
				session.session.customRequest("exposeUrlResponse", { originalUrl, exposedUrl: originalUrl });
			}
		} else if (e.event === "dart.debuggerUris") {
			session.observatoryUri = e.body.observatoryUri;
			session.vmServiceUri = e.body.vmServiceUri;
			this.onDebugSessionVmServiceAvailableEmitter.fire(session);

			// Open or prompt for DevTools when appropriate.
			const debuggerType: DebuggerType = session.session.configuration.debuggerType;
			if (debuggerType === DebuggerType.Dart || debuggerType === DebuggerType.Flutter || debuggerType === DebuggerType.Web) {
				if (config.openDevTools !== "never") {
					const shouldLaunch = debuggerType !== DebuggerType.Dart || config.openDevTools === "always";
					if (shouldLaunch)
						vs.commands.executeCommand("dart.openDevTools", { debugSessionId: session.session.id, triggeredAutomatically: true, page: null });
				} else if (debuggerType === DebuggerType.Flutter) {
					// tslint:disable-next-line: no-floating-promises
					showDevToolsNotificationIfAppropriate(this.context).then((res) => {
						if (res.shouldAlwaysOpen)
							config.setOpenDevTools("flutter");
					});
				}
			}
		} else if (e.event === "dart.progressStart") {
			const progressLocation = config.hotReloadProgress === "notification" && (e.body.progressID.endsWith("-hot.reload") || e.body.progressID.endsWith("-hot.restart")) ? vs.ProgressLocation.Notification : vs.ProgressLocation.Window;

			vs.window.withProgress(
				// TODO: This was previously Window to match what we'd get using DAP progress
				// notifications but users prefer larger notifications as they're easier to
				// see (especially when it comes to things like waiting for debug extension).
				// https://github.com/Dart-Code/Dart-Code/issues/2597
				// If this is changed back, ensure the waiting-for-debug-extension notification
				// is still displayed with additional description.
				{ location: progressLocation },
				(progress) => {
					// Complete any existing one with this ID.
					session.progress[e.body.progressID]?.complete();

					// Build a new progress and store it in the session.
					const completer = new PromiseCompleter<void>();
					session.progress[e.body.progressID] = new ProgressMessage(progress, completer);
					session.progress[e.body.progressID]?.report(e.body.message);
					return completer.promise;
				},
			);
		} else if (e.event === "dart.progressUpdate") {
			session.progress[e.body.progressID]?.report(e.body.message);
		} else if (e.event === "dart.progressEnd") {
			if (e.body.message) {
				session.progress[e.body.progressID]?.report(e.body.message);
				await new Promise((resolve) => setTimeout(resolve, 400));
			}
			session.progress[e.body.progressID]?.complete();
		} else if (e.event === "dart.flutter.widgetErrorInspectData") {
			if (this.suppressFlutterWidgetErrors || !config.showInspectorNotificationsForWidgetErrors)
				return;

			const data = e.body as WidgetErrorInspectData;
			if (data.devToolsUrl !== (await this.devTools.devtoolsUrl))
				return;

			// To avoid spam, when we show this dialog we will set a flag that prevents any more
			// of these types of dialogs until it is dismissed or 5 seconds have passed.
			this.suppressFlutterWidgetErrors = true;
			const timer = setTimeout(() => this.suppressFlutterWidgetErrors = false, 5000);

			const inspectAction = `Inspect Widget`;
			const choice = await vs.window.showWarningMessage(data.errorDescription, inspectAction, doNotAskAgainAction);
			if (choice === inspectAction && session.vmServiceUri) {
				this.devTools.spawnForSession(
					session as DartDebugSessionInformation & { vmServiceUri: string },
					{
						inspectorRef: data.inspectorReference,
						page: widgetInspectorPage,
					},
				);
			} else if (choice === doNotAskAgainAction) {
				config.setShowInspectorNotificationsForWidgetErrors(false);
			}
			clearTimeout(timer);
			this.suppressFlutterWidgetErrors = false;
		}
	}

	private toggleDebugOptions() {
		// -1 is because we skip the last combination when toggling since it seems uncommon.
		this.currentDebugOption = (this.currentDebugOption + 1) % (debugOptionNames.length - 1);
		this.applyNewDebugOption();
	}

	private applyNewDebugOption() {
		this.debugOptions.text = `Debug ${debugOptionNames[this.currentDebugOption]}`;

		const debugExternalLibraries = this.currentDebugOption === DebugOption.MyCodePackages || this.currentDebugOption === DebugOption.MyCodePackagesSdk;
		const debugSdkLibraries = this.currentDebugOption === DebugOption.MyCodeSdk || this.currentDebugOption === DebugOption.MyCodePackagesSdk;

		config.setGlobalDebugExternalLibraries(debugExternalLibraries);
		config.setGlobalDebugSdkLibraries(debugSdkLibraries);

		debugSessions.forEach((session) => {
			session.session.customRequest("updateDebugOptions", {
				debugExternalLibraries,
				debugSdkLibraries,
			});
		});
	}

	private sendServiceSetting(args: ServiceExtensionArgs) {
		debugSessions.forEach((session) => {
			session.session.customRequest("serviceExtension", args);
		});
	}

	private updateEditorContexts(e: vs.TextEditor | undefined): void {
		const isRunnable = !!(e && e.document && e.document.uri.scheme === "file" && isValidEntryFile(fsPath(e.document.uri)));
		vs.commands.executeCommand("setContext", CURRENT_FILE_RUNNABLE, isRunnable);
	}
}
