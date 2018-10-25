import * as fs from "fs";
import * as path from "path";
import * as vs from "vscode";
import { Analytics } from "../analytics";
import { Context } from "../context";
import { CoverageData, PromiseCompleter } from "../debug/utils";
import { FlutterServiceExtension, FlutterServiceExtensionArgs, FlutterVmServiceExtensions, timeDilationNormal, timeDilationSlow } from "../flutter/vm_service_extensions";
import { PubGlobal } from "../pub/global";
import { DevTools } from "../sdk/dev_tools";
import { showDevToolsNotificationIfAppropriate } from "../user_prompts";
import { fsPath, getDartWorkspaceFolders, openInBrowser, WorkspaceContext } from "../utils";
import { handleDebugLogEvent, logWarn } from "../utils/log";
import { DartDebugSessionInformation } from "../utils/vscode/debug";

export const debugSessions: DartDebugSessionInformation[] = [];
// export let mostRecentAttachedProbablyReusableObservatoryUri: string;

export class LastDebugSession {
	public static workspaceFolder?: vs.WorkspaceFolder;
	public static debugConfig?: vs.DebugConfiguration;
}

export class DebugCommands {
	private debugMetrics = vs.window.createStatusBarItem(vs.StatusBarAlignment.Right, 0);
	private onWillHotReloadEmitter: vs.EventEmitter<void> = new vs.EventEmitter<void>();
	public readonly onWillHotReload: vs.Event<void> = this.onWillHotReloadEmitter.event;
	private onWillHotRestartEmitter: vs.EventEmitter<void> = new vs.EventEmitter<void>();
	public readonly onWillHotRestart: vs.Event<void> = this.onWillHotRestartEmitter.event;
	private onReceiveCoverageEmitter: vs.EventEmitter<CoverageData[]> = new vs.EventEmitter<CoverageData[]>();
	public readonly onReceiveCoverage: vs.Event<CoverageData[]> = this.onReceiveCoverageEmitter.event;
	private onFirstFrameEmitter: vs.EventEmitter<CoverageData[]> = new vs.EventEmitter<CoverageData[]>();
	public readonly onFirstFrame: vs.Event<CoverageData[]> = this.onFirstFrameEmitter.event;
	private readonly flutterExtensions: FlutterVmServiceExtensions;
	private readonly devTools: DevTools;

	constructor(context: Context, workspaceContext: WorkspaceContext, analytics: Analytics, pubGlobal: PubGlobal) {
		this.flutterExtensions = new FlutterVmServiceExtensions(this.sendServiceSetting);
		this.devTools = new DevTools(workspaceContext.sdks, analytics, pubGlobal);
		context.subscriptions.push(this.devTools);
		context.subscriptions.push(this.debugMetrics);
		context.subscriptions.push(vs.debug.onDidReceiveDebugSessionCustomEvent((e) => {
			const session = debugSessions.find((ds) => ds.session.id === e.session.id);
			if (!session)
				return;
			this.flutterExtensions.handleDebugEvent(e);
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
				if (workspaceContext.hasAnyFlutterProjects)
					showDevToolsNotificationIfAppropriate(context);
				// if (e.body.isProbablyReconnectable) {
				// 	mostRecentAttachedProbablyReusableObservatoryUri = session.observatoryUri;
				// } else {
				// 	mostRecentAttachedProbablyReusableObservatoryUri = undefined;
				// }
			} else if (e.event === "dart.log") {
				handleDebugLogEvent(e.event, e.body);
			} else if (e.event === "dart.hotRestartRequest") {
				// This event comes back when the user restarts with the Restart button
				// (eg. it wasn't intiated from our extension, so we don't get to log it
				// in the command).
				analytics.logDebuggerRestart();
				this.onWillHotRestartEmitter.fire();
			} else if (e.event === "dart.hotReloadRequest") {
				// This event comes back when the user restarts with the Restart button
				// (eg. it wasn't intiated from our extension, so we don't get to log it
				// in the command).
				analytics.logDebuggerHotReload();
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
			}
		}));
		context.subscriptions.push(vs.debug.onDidStartDebugSession(async (s) => {
			let type = s.type;

			// The Visual Studio Live Share extension overrides the type to proxy debug sessions so
			// it won't be "dart". We can request the real info from it with the debugSessionInfo
			// custom request.
			if (type === "vslsShare") {
				const debugSessionInfo = await s.customRequest("debugSessionInfo");
				type = debugSessionInfo.configurationProperties.type;
			}

			if (type === "dart") {
				const session = new DartDebugSessionInformation(s);
				// If we're the first fresh debug session, reset all settings to default.
				// Subsequent launches will inherit the "current" values.
				if (debugSessions.length === 0)
					this.flutterExtensions.resetToDefaults();
				debugSessions.push(session);
			}
		}));
		context.subscriptions.push(vs.debug.onDidTerminateDebugSession((s) => {
			const sessionIndex = debugSessions.findIndex((ds) => ds.session.id === s.id);
			if (sessionIndex === -1)
				return;

			// Grab the session and remove it from the list so we don't try to interact with it anymore.
			const session = debugSessions[sessionIndex];
			debugSessions.splice(sessionIndex, 1);

			this.clearProgressIndicators(session);
			this.debugMetrics.hide();
			const debugSessionEnd = new Date();
			analytics.logDebugSessionDuration(debugSessionEnd.getTime() - session.sessionStart.getTime());
			// If this was the last session terminating, then remove all the flags for which service extensions are supported.
			// Really we should track these per-session, but the changes of them being different given we only support one
			// SDK at a time are practically zero.
			if (debugSessions.length === 0)
				this.flutterExtensions.markAllServiceExtensionsUnloaded();
		}));

		context.subscriptions.push(vs.commands.registerCommand("flutter.togglePlatform", () => this.flutterExtensions.toggle(FlutterServiceExtension.PlatformOverride, "iOS", "android")));
		context.subscriptions.push(vs.commands.registerCommand("flutter.toggleDebugPainting", () => this.flutterExtensions.toggle(FlutterServiceExtension.DebugPaint)));
		context.subscriptions.push(vs.commands.registerCommand("flutter.togglePerformanceOverlay", () => this.flutterExtensions.toggle(FlutterServiceExtension.PerformanceOverlay)));
		context.subscriptions.push(vs.commands.registerCommand("flutter.toggleRepaintRainbow", () => this.flutterExtensions.toggle(FlutterServiceExtension.RepaintRainbow)));
		context.subscriptions.push(vs.commands.registerCommand("flutter.toggleDebugModeBanner", () => this.flutterExtensions.toggle(FlutterServiceExtension.DebugBanner)));
		context.subscriptions.push(vs.commands.registerCommand("flutter.togglePaintBaselines", () => this.flutterExtensions.toggle(FlutterServiceExtension.PaintBaselines)));
		context.subscriptions.push(vs.commands.registerCommand("flutter.toggleSlowAnimations", () => this.flutterExtensions.toggle(FlutterServiceExtension.SlowAnimations, timeDilationNormal, timeDilationSlow)));
		context.subscriptions.push(vs.commands.registerCommand("flutter.inspectWidget", () => this.flutterExtensions.toggle(FlutterServiceExtension.InspectorSelectMode, true, true)));
		context.subscriptions.push(vs.commands.registerCommand("flutter.cancelInspectWidget", () => this.flutterExtensions.toggle(FlutterServiceExtension.InspectorSelectMode, false, false)));

		// Open Observatory.
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
		context.subscriptions.push(vs.commands.registerCommand("dart.openDevTools", async (): Promise<{ url: string, dispose: () => void }> => {
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
		context.subscriptions.push(vs.commands.registerCommand("flutter.attach", () => {
			vs.debug.startDebugging(undefined, {
				name: "Flutter: Attach to Process",
				request: "attach",
				type: "dart",
			});
		}));
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
				description: s.session.workspaceFolder.name,
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
