import * as fs from "fs";
import * as path from "path";
import * as vs from "vscode";
import { Analytics } from "../analytics";
import { CoverageData, PromiseCompleter } from "../debug/utils";
import { SERVICE_EXTENSION_CONTEXT_PREFIX } from "../extension";
import { TRACK_WIDGET_CREATION_ENABLED } from "../providers/debug_config_provider";
import { fsPath, getDartWorkspaceFolders, openInBrowser } from "../utils";
import { handleDebugLogEvent } from "../utils/log";

let debugPaintingEnabled = false;
let performanceOverlayEnabled = false;
let repaintRainbowEnabled = false;
let timeDilation = 1.0;
let debugModeBannerEnabled = true;
let paintBaselinesEnabled = false;
let widgetInspectorEnabled = false;
const debugSessions: DartDebugSessionInformation[] = [];

export class DebugCommands {
	private analytics: Analytics;

	private debugMetrics = vs.window.createStatusBarItem(vs.StatusBarAlignment.Right, 0);
	private onWillHotReloadEmitter: vs.EventEmitter<void> = new vs.EventEmitter<void>();
	public readonly onWillHotReload: vs.Event<void> = this.onWillHotReloadEmitter.event;
	private onWillHotRestartEmitter: vs.EventEmitter<void> = new vs.EventEmitter<void>();
	public readonly onWillHotRestart: vs.Event<void> = this.onWillHotRestartEmitter.event;
	private onReceiveCoverageEmitter: vs.EventEmitter<CoverageData[]> = new vs.EventEmitter<CoverageData[]>();
	public readonly onReceiveCoverage: vs.Event<CoverageData[]> = this.onReceiveCoverageEmitter.event;
	private onFirstFrameEmitter: vs.EventEmitter<CoverageData[]> = new vs.EventEmitter<CoverageData[]>();
	public readonly onFirstFrame: vs.Event<CoverageData[]> = this.onFirstFrameEmitter.event;

	constructor(context: vs.ExtensionContext, analytics: Analytics) {
		this.analytics = analytics;
		context.subscriptions.push(this.debugMetrics);
		context.subscriptions.push(vs.debug.onDidReceiveDebugSessionCustomEvent((e) => {
			const session = debugSessions.find((ds) => ds.session === e.session);
			if (!session)
				return;
			if (e.event === "dart.progress") {
				if (e.body.message) {
					// Clear any old progress first
					if (session.progressPromise)
						session.progressPromise.resolve();
					session.progressPromise = new PromiseCompleter();
					vs.window.withProgress(
						{ location: vs.ProgressLocation.Notification, title: e.body.message },
						(_) => session.progressPromise.promise,
					);
				}
				if (e.body.finished) {
					if (session.progressPromise) {
						session.progressPromise.resolve();
						session.progressPromise = null;
					}
				}
			} else if (e.event === "dart.observatoryUri") {
				session.observatoryUri = e.body.observatoryUri;
			} else if (e.event === "dart.log") {
				handleDebugLogEvent(e.event, e.body);
			} else if (e.event === "dart.restartRequest") {
				// This event comes back when the user restarts with the Restart button
				// (eg. it wasn't intiated from our extension, so we don't get to log it
				// in the hotReload command).
				analytics.logDebuggerHotReload();
				this.onWillHotReloadEmitter.fire();
			} else if (e.event === "dart.serviceExtensionAdded") {
				this.enableServiceExtension(e.body.id);
			} else if (e.event === "dart.flutter.firstFrame") {
				// Send the current value to ensure it persists for the user.
				this.sendAllServiceSettings();
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
					this.resetFlutterSettings();
				debugSessions.push(session);
			}
		}));
		context.subscriptions.push(vs.debug.onDidTerminateDebugSession((s) => {
			const sessionIndex = debugSessions.findIndex((ds) => ds.session === s);
			if (sessionIndex === -1)
				return;

			// Grab the session and remove it from the list so we don't try to interact with it anymore.
			const session = debugSessions[sessionIndex];
			debugSessions.splice(sessionIndex, 1);

			if (session.progressPromise)
				session.progressPromise.resolve();
			this.debugMetrics.hide();
			const debugSessionEnd = new Date();
			analytics.logDebugSessionDuration(debugSessionEnd.getTime() - session.sessionStart.getTime());
			// If this was the last session terminating, then remove all the flags for which service extensions are supported.
			// Really we should track these per-session, but the changes of them being different given we only support one
			// SDK at a time are practically zero.
			if (debugSessions.length === 0)
				this.disableAllServiceExtensions();
		}));

		this.registerBoolServiceCommand("ext.flutter.debugPaint", () => debugPaintingEnabled);
		this.registerBoolServiceCommand("ext.flutter.showPerformanceOverlay", () => performanceOverlayEnabled);
		this.registerBoolServiceCommand("ext.flutter.repaintRainbow", () => repaintRainbowEnabled);
		this.registerServiceCommand("ext.flutter.timeDilation", () => ({ timeDilation }));
		this.registerBoolServiceCommand("ext.flutter.debugAllowBanner", () => debugModeBannerEnabled);
		this.registerBoolServiceCommand("ext.flutter.debugPaintBaselinesEnabled", () => paintBaselinesEnabled);
		this.registerBoolServiceCommand("ext.flutter.debugWidgetInspector", () => widgetInspectorEnabled);
		context.subscriptions.push(vs.commands.registerCommand("flutter.toggleDebugPainting", () => { debugPaintingEnabled = !debugPaintingEnabled; this.sendServiceSetting("ext.flutter.debugPaint"); }));
		context.subscriptions.push(vs.commands.registerCommand("flutter.togglePerformanceOverlay", () => { performanceOverlayEnabled = !performanceOverlayEnabled; this.sendServiceSetting("ext.flutter.showPerformanceOverlay"); }));
		context.subscriptions.push(vs.commands.registerCommand("flutter.toggleRepaintRainbow", () => { repaintRainbowEnabled = !repaintRainbowEnabled; this.sendServiceSetting("ext.flutter.repaintRainbow"); }));
		context.subscriptions.push(vs.commands.registerCommand("flutter.toggleSlowAnimations", () => { timeDilation = 6.0 - timeDilation; this.sendServiceSetting("ext.flutter.timeDilation"); }));
		context.subscriptions.push(vs.commands.registerCommand("flutter.toggleDebugModeBanner", () => { debugModeBannerEnabled = !debugModeBannerEnabled; this.sendServiceSetting("ext.flutter.debugAllowBanner"); }));
		context.subscriptions.push(vs.commands.registerCommand("flutter.togglePaintBaselines", () => { paintBaselinesEnabled = !paintBaselinesEnabled; this.sendServiceSetting("ext.flutter.debugPaintBaselinesEnabled"); }));
		context.subscriptions.push(vs.commands.registerCommand("flutter.toggleWidgetInspector", () => { widgetInspectorEnabled = !widgetInspectorEnabled; this.sendServiceSetting("ext.flutter.debugWidgetInspector"); }));

		// Open Observatory.
		context.subscriptions.push(vs.commands.registerCommand("dart.openObservatory", async () => {
			if (!debugSessions.length)
				return;
			const session = debugSessions.length === 1
				? debugSessions[0]
				: await this.promptForDebugSession();
			if (session && session.observatoryUri) {
				openInBrowser(session.observatoryUri);
				analytics.logDebuggerOpenObservatory();
			}
		}));
		context.subscriptions.push(vs.commands.registerCommand("flutter.openTimeline", async () => {
			if (!debugSessions.length)
				return;
			const session = debugSessions.length === 1
				? debugSessions[0]
				: await this.promptForDebugSession();
			if (session && session.observatoryUri) {
				openInBrowser(session.observatoryUri + "/#/timeline-dashboard");
				analytics.logDebuggerOpenTimeline();
			}
		}));

		// Misc custom debug commands.
		context.subscriptions.push(vs.commands.registerCommand("flutter.hotReload", () => {
			if (!debugSessions.length)
				return;
			this.onWillHotReloadEmitter.fire();
			debugSessions.forEach((s) => this.sendCustomFlutterDebugCommand(s, "hotReload"));
			analytics.logDebuggerHotReload();
		}));
		context.subscriptions.push(vs.commands.registerCommand("flutter.hotRestart", () => {
			if (!debugSessions.length)
				return;
			this.onWillHotRestartEmitter.fire();
			debugSessions.forEach((s) => this.sendCustomFlutterDebugCommand(s, "hotRestart"));
			analytics.logDebuggerRestart();
		}));
		context.subscriptions.push(vs.commands.registerCommand("_dart.requestCoverageUpdate", (scriptUris: string[]) => {
			debugSessions.forEach((s) => this.sendCustomFlutterDebugCommand(s, "requestCoverageUpdate", { scriptUris }));
		}));
		context.subscriptions.push(vs.commands.registerCommand("_dart.coverageFilesUpdate", (scriptUris: string[]) => {
			debugSessions.forEach((s) => this.sendCustomFlutterDebugCommand(s, "coverageFilesUpdate", { scriptUris }));
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
					cwd: path.dirname(folder),
					name: `Dart ${name}`,
					noDebug: true,
					request: "launch",
					runner: "tests",
					type: "dart",
				});
			}
		}));

		// Flutter toggle platform.
		// We can't just use a service command here, as we need to call it twice (once to get, once to change) and
		// currently it seems like the DA can't return responses to us here, so we'll have to do them both inside the DA.
		context.subscriptions.push(vs.commands.registerCommand("flutter.togglePlatform", () => {
			debugSessions.forEach((s) => this.sendCustomFlutterDebugCommand(s, "togglePlatform"));
		}));

		// Attach commands.
		context.subscriptions.push(vs.commands.registerCommand("dart.attach", () => {
			vs.debug.startDebugging(undefined, {
				name: "Dart: Attach to Process",
				request: "attach",
				type: "dart",
			});
		}));
	}

	private async promptForDebugSession(): Promise<DartDebugSessionInformation> {
		const selectedItem = await vs.window.showQuickPick(
			debugSessions.map((s) => ({
				description: `Started ${s.sessionStart.toLocaleTimeString()}`,
				label: s.session.name,
				session: s,
			})),
			{
				placeHolder: "Which debug session?",
			},
		);

		return selectedItem && selectedItem.session;
	}

	private serviceSettings: { [id: string]: () => void } = {};
	private sendServiceSetting(id: string) {
		if (this.serviceSettings[id] && this.enabledServiceExtensions.indexOf(id) !== -1)
			this.serviceSettings[id]();
	}

	private sendAllServiceSettings() {
		for (const id in this.serviceSettings)
			this.sendServiceSetting(id);
	}

	private registerBoolServiceCommand(id: string, getValue: () => boolean): void {
		this.serviceSettings[id] = () => {
			debugSessions.forEach((s) => this.runBoolServiceCommand(s, id, getValue()));
		};
	}

	private registerServiceCommand(id: string, getValue: () => any): void {
		this.serviceSettings[id] = () => {
			debugSessions.forEach((s) => this.runServiceCommand(s, id, getValue()));
		};
	}

	private runServiceCommand(session: DartDebugSessionInformation, method: string, params: any) {
		this.sendCustomFlutterDebugCommand(session, "serviceExtension", { type: method, params });
	}

	private runBoolServiceCommand(session: DartDebugSessionInformation, method: string, enabled: boolean) {
		this.runServiceCommand(session, method, { enabled });
	}

	private sendCustomFlutterDebugCommand(session: DartDebugSessionInformation, type: string, args?: any) {
		session.session.customRequest(type, args);
	}

	private resetFlutterSettings() {
		debugPaintingEnabled = false;
		performanceOverlayEnabled = false;
		repaintRainbowEnabled = false;
		timeDilation = 1.0;
		debugModeBannerEnabled = true;
		paintBaselinesEnabled = false;
		widgetInspectorEnabled = false;
	}

	private enabledServiceExtensions: string[] = [];
	private enableServiceExtension(id: string) {
		this.enabledServiceExtensions.push(id);
		vs.commands.executeCommand("setContext", `${SERVICE_EXTENSION_CONTEXT_PREFIX}${id}`, true);
	}

	private disableAllServiceExtensions() {
		for (const id of this.enabledServiceExtensions) {
			vs.commands.executeCommand("setContext", `${SERVICE_EXTENSION_CONTEXT_PREFIX}${id}`, undefined);
		}
		this.enabledServiceExtensions.length = 0;
		vs.commands.executeCommand("setContext", TRACK_WIDGET_CREATION_ENABLED, false);
	}
}

class DartDebugSessionInformation {
	public observatoryUri: string;
	public progressPromise: PromiseCompleter<void>;
	public readonly sessionStart: Date = new Date();
	constructor(public readonly session: vs.DebugSession) { }
}
