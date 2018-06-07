import * as vs from "vscode";
import { Analytics } from "../analytics";
import { PromiseCompleter } from "../debug/utils";
import { SERVICE_EXTENSION_CONTEXT_PREFIX } from "../extension";
import { LogCategory, fsPath, log, logError, openInBrowser } from "../utils";

let debugPaintingEnabled = false;
let performanceOverlayEnabled = false;
let repaintRainbowEnabled = false;
let timeDilation = 1.0;
let debugModeBannerEnabled = true;
let paintBaselinesEnabled = false;
let currentDebugSession: vs.DebugSession;
let progressPromise: PromiseCompleter<void>;
let observatoryUri: string = null;

export class DebugCommands {
	private analytics: Analytics;

	// TODO: Do we need to push these into context?
	private reloadStatus = vs.window.createStatusBarItem(vs.StatusBarAlignment.Left);
	private debugMetrics = vs.window.createStatusBarItem(vs.StatusBarAlignment.Right, 0);

	constructor(context: vs.ExtensionContext, analytics: Analytics) {
		this.analytics = analytics;
		context.subscriptions.push(this.reloadStatus, this.debugMetrics);
		context.subscriptions.push(vs.debug.onDidReceiveDebugSessionCustomEvent((e) => {
			if (e.event === "dart.progress") {
				if (e.body.message) {
					// Clear any old progress first
					if (progressPromise)
						progressPromise.resolve();
					progressPromise = new PromiseCompleter();
					vs.window.withProgress(
						{ location: vs.ProgressLocation.Notification, title: e.body.message },
						(_) => progressPromise.promise,
					);
				}
				if (e.body.finished) {
					if (progressPromise) {
						progressPromise.resolve();
						progressPromise = null;
					}
				}
			} else if (e.event === "dart.observatoryUri") {
				observatoryUri = e.body.observatoryUri;
			} else if (e.event === "dart.log.observatory") {
				log(e.body.message, LogCategory.Observatory);
			} else if (e.event === "dart.log.flutter.run") {
				log(e.body.message, LogCategory.FlutterRun);
			} else if (e.event === "dart.log.flutter.test") {
				log(e.body.message, LogCategory.FlutterTest);
			} else if (e.event === "dart.restartRequest") {
				// This event comes back when the user restarts with the Restart button
				// (eg. it wasn't intiated from our extension, so we don't get to log it
				// in the hotReload command).
				analytics.logDebuggerHotReload();
				this.reloadStatus.hide(); // Also remove stale reload status when this happened.
			} else if (e.event === "dart.hint" && e.body && e.body.hintId) {
				switch (e.body.hintId) {
					case "restartRecommended":
						this.promptForHotRestart(e.body.hintMessage);
						break;
					default:
						if (e.body.hintMessage)
							vs.window.showInformationMessage(e.body.hintMessage);
						else
							logError({ message: `Unexpected hint from debugger: ${e.body.hintId}, ${e.body.hintMessage}` });
				}
			} else if (e.event === "dart.serviceExtensionAdded") {
				this.enableServiceExtension(e.body.id);
			} else if (e.event === "dart.flutter.firstFrame") {
				// Send the current value to ensure it persists for the user.
				this.sendAllServiceSettings();
			} else if (e.event === "dart.debugMetrics") {
				const memory = e.body.memory;
				const message = `${Math.ceil(memory.current / 1024 / 1024)}MB of ${Math.ceil(memory.total / 1024 / 1024)}MB`;
				this.debugMetrics.text = message;
				this.debugMetrics.tooltip = "This is the amount of memory being consumed by your applications heaps (out of what has been allocated).\n\nNote: memory usage shown in debug builds may not be indicative of usage in release builds. Use profile builds for more accurate figures when testing memory usage.";
				this.debugMetrics.show();
			}
		}));
		let debugSessionStart: Date;
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
				currentDebugSession = s;
				this.resetFlutterSettings();
				debugSessionStart = new Date();
			}
		}));
		context.subscriptions.push(vs.debug.onDidTerminateDebugSession((s) => {
			if (s === currentDebugSession) {
				currentDebugSession = null;
				observatoryUri = null;
				if (progressPromise)
					progressPromise.resolve();
				this.reloadStatus.hide();
				this.debugMetrics.hide();
				const debugSessionEnd = new Date();
				this.disableAllServiceExtensions();
				analytics.logDebugSessionDuration(debugSessionEnd.getTime() - debugSessionStart.getTime());
			}
		}));

		this.registerBoolServiceCommand("ext.flutter.debugPaint", () => debugPaintingEnabled);
		this.registerBoolServiceCommand("ext.flutter.showPerformanceOverlay", () => performanceOverlayEnabled);
		this.registerBoolServiceCommand("ext.flutter.repaintRainbow", () => repaintRainbowEnabled);
		this.registerServiceCommand("ext.flutter.timeDilation", () => ({ timeDilation }));
		this.registerBoolServiceCommand("ext.flutter.debugAllowBanner", () => debugModeBannerEnabled);
		this.registerBoolServiceCommand("ext.flutter.debugPaintBaselinesEnabled", () => paintBaselinesEnabled);
		context.subscriptions.push(vs.commands.registerCommand("flutter.toggleDebugPainting", () => { debugPaintingEnabled = !debugPaintingEnabled; this.sendServiceSetting("ext.flutter.debugPaint"); }));
		context.subscriptions.push(vs.commands.registerCommand("flutter.togglePerformanceOverlay", () => { performanceOverlayEnabled = !performanceOverlayEnabled; this.sendServiceSetting("ext.flutter.showPerformanceOverlay"); }));
		context.subscriptions.push(vs.commands.registerCommand("flutter.toggleRepaintRainbow", () => { repaintRainbowEnabled = !repaintRainbowEnabled; this.sendServiceSetting("ext.flutter.repaintRainbow"); }));
		context.subscriptions.push(vs.commands.registerCommand("flutter.toggleSlowAnimations", () => { timeDilation = 6.0 - timeDilation; this.sendServiceSetting("ext.flutter.timeDilation"); }));
		context.subscriptions.push(vs.commands.registerCommand("flutter.toggleDebugModeBanner", () => { debugModeBannerEnabled = !debugModeBannerEnabled; this.sendServiceSetting("ext.flutter.debugAllowBanner"); }));
		context.subscriptions.push(vs.commands.registerCommand("flutter.togglePaintBaselines", () => { paintBaselinesEnabled = !paintBaselinesEnabled; this.sendServiceSetting("ext.flutter.debugPaintBaselinesEnabled"); }));

		// Open Observatory.
		context.subscriptions.push(vs.commands.registerCommand("dart.openObservatory", () => {
			if (observatoryUri) {
				openInBrowser(observatoryUri);
				analytics.logDebuggerOpenObservatory();
			}
		}));
		context.subscriptions.push(vs.commands.registerCommand("flutter.openTimeline", () => {
			if (observatoryUri) {
				openInBrowser(observatoryUri + "/#/timeline-dashboard");
				analytics.logDebuggerOpenTimeline();
			}
		}));

		// Misc custom debug commands.
		context.subscriptions.push(vs.commands.registerCommand("flutter.hotReload", () => {
			if (!currentDebugSession)
				return;
			this.reloadStatus.hide();
			this.sendCustomFlutterDebugCommand("hotReload");
			analytics.logDebuggerHotReload();
		}));
		context.subscriptions.push(vs.commands.registerCommand("flutter.hotRestart", () => {
			if (!currentDebugSession)
				return;
			this.reloadStatus.hide();
			this.sendCustomFlutterDebugCommand("hotRestart");
			analytics.logDebuggerRestart();
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

		// Flutter toggle platform.
		// We can't just use a service command here, as we need to call it twice (once to get, once to change) and
		// currently it seems like the DA can't return responses to us here, so we'll have to do them both inside the DA.
		context.subscriptions.push(vs.commands.registerCommand("flutter.togglePlatform", () => this.sendCustomFlutterDebugCommand("togglePlatform")));

		// Attach commands.
		context.subscriptions.push(vs.commands.registerCommand("dart.attach", () => {
			if (currentDebugSession)
				return;
			vs.debug.startDebugging(undefined, {
				name: "Dart: Attach to Process",
				request: "attach",
				type: "dart",
			});
		}));
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
		this.serviceSettings[id] = () => this.runBoolServiceCommand(id, getValue());
	}

	private registerServiceCommand(id: string, getValue: () => any): void {
		this.serviceSettings[id] = () => this.runServiceCommand(id, getValue());
	}

	private promptForHotRestart(message: string) {
		this.reloadStatus.text = "↻ Hot restart may be required";
		this.reloadStatus.tooltip = message + "\r\n\r\nClick to restart";
		this.reloadStatus.command = "flutter.hotRestart";
		this.reloadStatus.show();
	}

	private runServiceCommand(method: string, params: any) {
		this.sendCustomFlutterDebugCommand("serviceExtension", { type: method, params });
	}

	private runBoolServiceCommand(method: string, enabled: boolean) {
		this.runServiceCommand(method, { enabled });
	}

	private sendCustomFlutterDebugCommand(type: string, args?: any) {
		if (currentDebugSession)
			currentDebugSession.customRequest(type, args);
	}

	private resetFlutterSettings() {
		debugPaintingEnabled = false;
		performanceOverlayEnabled = false;
		repaintRainbowEnabled = false;
		timeDilation = 1.0;
		debugModeBannerEnabled = true;
		paintBaselinesEnabled = false;
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
	}
}
