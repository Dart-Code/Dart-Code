import * as fs from "fs";
import * as path from "path";
import * as vs from "vscode";
import { Context } from "../../shared/workspace";
import { Analytics } from "../analytics";
import { CoverageData, PromiseCompleter } from "../debug/utils";
import { FlutterServiceExtension, FlutterServiceExtensionArgs, FlutterVmServiceExtensions, timeDilationNormal, timeDilationSlow } from "../flutter/vm_service_extensions";
import { DebuggerType } from "../providers/debug_config_provider";
import { PubGlobal } from "../pub/global";
import { DevToolsManager } from "../sdk/dev_tools";
import { showDevToolsNotificationIfAppropriate } from "../user_prompts";
import { fsPath, getDartWorkspaceFolders, openInBrowser, WorkspaceContext } from "../utils";
import { handleDebugLogEvent, logInfo, logWarn } from "../utils/log";
import { DartDebugSessionInformation } from "../utils/vscode/debug";

// TODO: Try to avoid exporting this...
export const debugSessions: DartDebugSessionInformation[] = [];
// export let mostRecentAttachedProbablyReusableObservatoryUri: string;

// As a workaround for https://github.com/Microsoft/vscode/issues/71651 we
// will keep any events that arrive before their session "started" and then
// replace them when the start event comes through.
let pendingCustomEvents: vs.DebugSessionCustomEvent[] = [];

export class LastDebugSession {
	public static workspaceFolder?: vs.WorkspaceFolder;
	public static debugConfig?: vs.DebugConfiguration;
}

export class DebugCommands {
	private debugMetrics = vs.window.createStatusBarItem(vs.StatusBarAlignment.Right, 0);
	private onWillHotReloadEmitter = new vs.EventEmitter<void>();
	public readonly onWillHotReload = this.onWillHotReloadEmitter.event;
	private onWillHotRestartEmitter = new vs.EventEmitter<void>();
	public readonly onWillHotRestart = this.onWillHotRestartEmitter.event;
	private onReceiveCoverageEmitter = new vs.EventEmitter<CoverageData[]>();
	public readonly onReceiveCoverage = this.onReceiveCoverageEmitter.event;
	private onFirstFrameEmitter = new vs.EventEmitter<void>();
	public readonly onFirstFrame = this.onFirstFrameEmitter.event;
	private onDebugSessionVmServiceAvailableEmitter = new vs.EventEmitter<DartDebugSessionInformation>();
	public readonly onDebugSessionVmServiceAvailable = this.onDebugSessionVmServiceAvailableEmitter.event;
	public readonly flutterExtensions: FlutterVmServiceExtensions;
	private readonly devTools: DevToolsManager;

	constructor(private readonly context: Context, workspaceContext: WorkspaceContext, private readonly analytics: Analytics, pubGlobal: PubGlobal) {
		this.flutterExtensions = new FlutterVmServiceExtensions(this.sendServiceSetting);
		this.devTools = new DevToolsManager(workspaceContext.sdks, this, analytics, pubGlobal);
		context.subscriptions.push(this.devTools);
		context.subscriptions.push(this.debugMetrics);

		context.subscriptions.push(vs.debug.onDidStartDebugSession((s) => this.handleDebugSessionStart(s)));
		context.subscriptions.push(vs.debug.onDidReceiveDebugSessionCustomEvent((e) => this.handleDebugSessionCustomEvent(e)));
		context.subscriptions.push(vs.debug.onDidTerminateDebugSession((s) => this.handleDebugSessionEnd(s)));

		context.subscriptions.push(vs.commands.registerCommand("flutter.togglePlatform", () => this.flutterExtensions.toggle(FlutterServiceExtension.PlatformOverride, "iOS", "android")));
		context.subscriptions.push(vs.commands.registerCommand("flutter.toggleDebugPainting", () => this.flutterExtensions.toggle(FlutterServiceExtension.DebugPaint)));
		context.subscriptions.push(vs.commands.registerCommand("flutter.togglePerformanceOverlay", () => this.flutterExtensions.toggle(FlutterServiceExtension.PerformanceOverlay)));
		context.subscriptions.push(vs.commands.registerCommand("flutter.toggleRepaintRainbow", () => this.flutterExtensions.toggle(FlutterServiceExtension.RepaintRainbow)));
		context.subscriptions.push(vs.commands.registerCommand("flutter.toggleDebugModeBanner", () => this.flutterExtensions.toggle(FlutterServiceExtension.DebugBanner)));
		context.subscriptions.push(vs.commands.registerCommand("flutter.toggleCheckElevations", () => this.flutterExtensions.toggle(FlutterServiceExtension.CheckElevations)));
		context.subscriptions.push(vs.commands.registerCommand("flutter.togglePaintBaselines", () => this.flutterExtensions.toggle(FlutterServiceExtension.PaintBaselines)));
		context.subscriptions.push(vs.commands.registerCommand("flutter.toggleSlowAnimations", () => this.flutterExtensions.toggle(FlutterServiceExtension.SlowAnimations, timeDilationNormal, timeDilationSlow)));
		context.subscriptions.push(vs.commands.registerCommand("flutter.inspectWidget", () => this.flutterExtensions.toggle(FlutterServiceExtension.InspectorSelectMode, true, true)));
		context.subscriptions.push(vs.commands.registerCommand("flutter.cancelInspectWidget", () => this.flutterExtensions.toggle(FlutterServiceExtension.InspectorSelectMode, false, false)));

		context.subscriptions.push(vs.commands.registerCommand("dart.openObservatory", async () => {
			if (!debugSessions.length)
				return;
			const session = debugSessions.length === 1
				? debugSessions[0]
				: await this.promptForDebugSession();
			if (session && !session.session.configuration.noDebug && session.observatoryUri) {
				openInBrowser(session.observatoryUri);
				analytics.logDebuggerOpenObservatory();
			} else if (session) {
				logWarn("Cannot start Observatory for session without debug/observatoryUri");
			}
		}));
		context.subscriptions.push(vs.commands.registerCommand("flutter.openTimeline", async () => {
			if (!debugSessions.length)
				return;
			const session = debugSessions.length === 1
				? debugSessions[0]
				: await this.promptForDebugSession();
			if (session && !session.session.configuration.noDebug && session.observatoryUri) {
				openInBrowser(session.observatoryUri + "/#/timeline-dashboard");
				analytics.logDebuggerOpenTimeline();
			} else if (session) {
				logWarn("Cannot start Observatory for session without debug/observatoryUri");
			}
		}));
		context.subscriptions.push(vs.commands.registerCommand("_dart.openDevTools.touchBar", (args: any) => vs.commands.executeCommand("dart.openDevTools", args)));
		context.subscriptions.push(vs.commands.registerCommand("dart.openDevTools", async (): Promise<{ url: string, dispose: () => void } | undefined> => {
			if (!debugSessions.length) {
				vs.window.showInformationMessage("Dart DevTools requires an active debug session.");
				return;
			}
			const session = debugSessions.length === 1
				? debugSessions[0]
				: await this.promptForDebugSession();
			if (!session)
				return; // User cancelled

			if (session.vmServiceUri) {
				return this.devTools.spawnForSession(session);
			} else if (session.session.configuration.noDebug) {
				vs.window.showInformationMessage("You must start your app with debugging in order to use DevTools.");
			} else {
				vs.window.showInformationMessage("This debug session is not ready yet.");
			}
		}));

		// Misc custom debug commands.
		context.subscriptions.push(vs.commands.registerCommand("_flutter.hotReload.touchBar", (args: any) => vs.commands.executeCommand("flutter.hotReload", args)));
		context.subscriptions.push(vs.commands.registerCommand("flutter.hotReload", (args: any) => {
			if (!debugSessions.length)
				return;
			this.onWillHotReloadEmitter.fire();
			debugSessions.forEach((s) => s.session.customRequest("hotReload", args));
			analytics.logDebuggerHotReload();
		}));
		context.subscriptions.push(vs.commands.registerCommand("flutter.hotRestart", (args: any) => {
			if (!debugSessions.length)
				return;
			this.onWillHotRestartEmitter.fire();
			debugSessions.forEach((s) => s.session.customRequest("hotRestart", args));
			analytics.logDebuggerRestart();
		}));
		context.subscriptions.push(vs.commands.registerCommand("_dart.requestCoverageUpdate", (scriptUris: string[]) => {
			debugSessions.forEach((s) => s.session.customRequest("requestCoverageUpdate", { scriptUris }));
		}));
		context.subscriptions.push(vs.commands.registerCommand("_dart.coverageFilesUpdate", (scriptUris: string[]) => {
			debugSessions.forEach((s) => s.session.customRequest("coverageFilesUpdate", { scriptUris }));
		}));
		context.subscriptions.push(vs.commands.registerCommand("dart.startDebugging", (resource: vs.Uri) => {
			vs.debug.startDebugging(vs.workspace.getWorkspaceFolder(resource), {
				name: "Dart",
				program: fsPath(resource),
				request: "launch",
				type: "dart",
			});
		}));
		context.subscriptions.push(vs.commands.registerCommand("dart.startWithoutDebugging", (resource: vs.Uri) => {
			vs.debug.startDebugging(vs.workspace.getWorkspaceFolder(resource), {
				name: "Dart",
				noDebug: true,
				program: fsPath(resource),
				request: "launch",
				type: "dart",
			});
		}));
		context.subscriptions.push(vs.commands.registerCommand("dart.runAllTestsWithoutDebugging", () => {
			const testFolders = getDartWorkspaceFolders()
				.map((project) => path.join(fsPath(project.uri), "test"))
				.filter((testFolder) => fs.existsSync(testFolder));
			if (testFolders.length === 0) {
				vs.window.showErrorMessage("Unable to find any test folders");
				return;
			}
			for (const folder of testFolders) {
				const ws = vs.workspace.getWorkspaceFolder(vs.Uri.file(folder));
				const name = path.basename(path.dirname(folder));
				vs.debug.startDebugging(ws, {
					name: `Dart ${name}`,
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
				observatoryUri: "${command:dart.promptForVmService}",
				request: "attach",
				type: "dart",
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
				placeHolder: "Paste an Observatory URI",
				prompt: "Enter Observatory URI",
				validateInput: (input) => {
					if (!input)
						return;

					input = input.trim();

					if (Number.isInteger(parseFloat(input)))
						return;

					// Uri.parse doesn't seem to work as expected, so do our own basic validation
					// https://github.com/Microsoft/vscode/issues/49818

					if (!input.startsWith("http://") && !input.startsWith("https://"))
						return "Please enter a valid Observatory URI";
				},
				value: defaultValue,
			});
		}));
	}

	public handleDebugSessionStart(s: vs.DebugSession): void {
		if (s.type === "dart") {
			const session = new DartDebugSessionInformation(s);
			// If we're the first fresh debug session, reset all settings to default.
			// Subsequent launches will inherit the "current" values.
			if (debugSessions.length === 0)
				this.flutterExtensions.resetToDefaults();
			debugSessions.push(session);

			// Process any queued events that came in before the session start
			// event.
			const eventsToProcess = pendingCustomEvents.filter((e) => e.session.id === s.id);
			pendingCustomEvents = pendingCustomEvents.filter((e) => e.session.id !== s.id);

			eventsToProcess.forEach((e) => {
				logInfo(`Processing delayed event ${e.event} for session ${e.session.id}`);
				this.handleCustomEventWithSession(session, e);
			});
		}
	}

	public handleDebugSessionCustomEvent(e: vs.DebugSessionCustomEvent): void {
		this.flutterExtensions.handleDebugEvent(e);
		if (this.handleCustomEvent(e))
			return;
		const session = debugSessions.find((ds) => ds.session.id === e.session.id);
		if (!session) {
			logWarn(`Did not find session ${e.session.id} to handle ${e.event}. There were ${debugSessions.length} sessions:\n${debugSessions.map((ds) => `  ${ds.session.id}`).join("\n")}`);
			logWarn(`Event will be queued and processed when the session start event fires`);
			pendingCustomEvents.push(e);
			return;
		}
		this.handleCustomEventWithSession(session, e);
	}

	public handleDebugSessionEnd(s: vs.DebugSession): void {
		const sessionIndex = debugSessions.findIndex((ds) => ds.session.id === s.id);
		if (sessionIndex === -1)
			return;

		// Grab the session and remove it from the list so we don't try to interact with it anymore.
		const session = debugSessions[sessionIndex];
		debugSessions.splice(sessionIndex, 1);

		this.clearProgressIndicators(session);
		this.debugMetrics.hide();
		const debugSessionEnd = new Date();
		this.analytics.logDebugSessionDuration(debugSessionEnd.getTime() - session.sessionStart.getTime());
		// If this was the last session terminating, then remove all the flags for which service extensions are supported.
		// Really we should track these per-session, but the changes of them being different given we only support one
		// SDK at a time are practically zero.
		if (debugSessions.length === 0)
			this.flutterExtensions.markAllServicesUnloaded();
	}

	private handleCustomEvent(e: vs.DebugSessionCustomEvent): boolean {
		if (e.event === "dart.log") {
			handleDebugLogEvent(e.event, e.body);
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
		} else if (e.event === "dart.coverage") {
			this.onReceiveCoverageEmitter.fire(e.body);
		} else if (e.event === "dart.navigate") {
			if (e.body.file && e.body.line && e.body.column)
				vs.commands.executeCommand("_dart.jumpToLineColInUri", vs.Uri.parse(e.body.file), e.body.line, e.body.column);
		} else {
			// Not handled, will fall through in the caller.
			return false;
		}
		return true;
	}

	private handleCustomEventWithSession(session: DartDebugSessionInformation, e: vs.DebugSessionCustomEvent) {
		if (e.event === "dart.launching") {
			vs.window.withProgress(
				{ location: vs.ProgressLocation.Notification },
				(progress) => {
					progress.report({ message: e.body.message });
					session.launchProgressReporter = progress;
					return session.launchProgressPromise.promise;
				},
			);
		} else if (e.event === "dart.launched") {
			this.clearProgressIndicators(session);
		} else if (e.event === "dart.progress") {
			if (e.body.message) {
				if (session.launchProgressReporter) {
					session.launchProgressReporter.report({ message: e.body.message });
				} else if (session.progressReporter) {
					session.progressReporter.report({ message: e.body.message });
				} else {
					session.progressID = e.body.progressID;
					vs.window.withProgress(
						{ location: vs.ProgressLocation.Notification },
						(progress) => {
							progress.report({ message: e.body.message });
							session.progressReporter = progress;
							if (!session.progressPromise)
								session.progressPromise = new PromiseCompleter<void>();
							return session.progressPromise.promise;
						},
					);
				}
			}
			if (e.body.finished) {
				if (session.launchProgressReporter) {
					// Ignore "finished" events during launch, as we'll keep the progress indicator
					// until we get dart.launched.
				} else if (session.progressID === e.body.progressID) {
					// Otherwise, signal completion if it matches the thing that started the progress.
					if (session.progressPromise)
						session.progressPromise.resolve();
					session.progressPromise = undefined;
					session.progressReporter = undefined;
				}
			}
		} else if (e.event === "dart.debuggerUris") {
			session.observatoryUri = e.body.observatoryUri;
			session.vmServiceUri = e.body.vmServiceUri;
			const debuggerType: DebuggerType = session.session.configuration.debuggerType;
			if (debuggerType === DebuggerType.Flutter || debuggerType === DebuggerType.FlutterWeb)
				showDevToolsNotificationIfAppropriate(this.context);
			this.onDebugSessionVmServiceAvailableEmitter.fire(session);
			// if (e.body.isProbablyReconnectable) {
			// 	mostRecentAttachedProbablyReusableObservatoryUri = session.observatoryUri;
			// } else {
			// 	mostRecentAttachedProbablyReusableObservatoryUri = undefined;
			// }
		}
	}

	private clearProgressIndicators(session: DartDebugSessionInformation): void {
		if (session.launchProgressPromise)
			session.launchProgressPromise.resolve();
		session.launchProgressReporter = undefined;
		if (session.progressPromise)
			session.progressPromise.resolve();
		session.progressPromise = undefined;
		session.progressReporter = undefined;
	}

	private async promptForDebugSession(): Promise<DartDebugSessionInformation | undefined> {
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

	private sendServiceSetting(extension: FlutterServiceExtension, args: FlutterServiceExtensionArgs) {
		debugSessions.forEach((session) => {
			session.session.customRequest("serviceExtension", args);
		});
	}
}
