"use strict";

import { Analytics } from "../analytics";
import * as channels from "./channels";
import * as child_process from "child_process";
import * as os from "os";
import * as path from "path";
import * as project from "../project";
import * as vs from "vscode";
import { config } from "../config";
import { openInBrowser, logError } from "../utils";
import { FlutterLaunchRequestArguments, isWin } from "../debug/utils";
import { FlutterDeviceManager } from "../flutter/device_manager";
import { SdkManager } from "../sdk/sdk_manager";
import { FLUTTER_DEBUG_TYPE, DART_CLI_DEBUG_TYPE } from "../providers/debug_config_provider";
import { Uri } from "vscode";

export class DebugCommands {
	private analytics: Analytics;
	private debugPaintingEnabled = false;
	private performanceOverlayEnabled = false;
	private repaintRainbowEnabled = false;
	private timeDilation = 1.0;
	private slowModeBannerEnabled = true;
	private paintBaselinesEnabled = false;
	private currentFlutterDebugSession: vs.DebugSession;
	private debugStatus = vs.window.createStatusBarItem(vs.StatusBarAlignment.Left);
	private observatoryUri: string = null;

	constructor(context: vs.ExtensionContext, analytics: Analytics) {
		this.analytics = analytics;
		context.subscriptions.push(this.debugStatus);
		vs.debug.onDidReceiveDebugSessionCustomEvent((e) => {
			if (e.event === "dart.progress") {
				if (e.body.message) {
					this.debugStatus.text = e.body.message;
					this.debugStatus.show();
				}
				if (e.body.finished)
					this.debugStatus.hide();
			} else if (e.event === "dart.observatoryUri") {
				this.observatoryUri = e.body.observatoryUri;
			} else if (e.event === "dart.restartRequest") {
				// This event comes back when the user restarts with the Restart button
				// (eg. it wasn't intiated from our extension, so we don't get to log it
				// in the hotReload command).
				analytics.logDebuggerHotReload();
			} else if (e.event === "dart.hint" && e.body && e.body.hintId) {
				switch (e.body.hintId) {
					case "restartRecommended":
						this.promptForFullRestart();
						break;
					default:
						if (e.body.hintMessage)
							vs.window.showInformationMessage(e.body.hintMessage);
						else
							logError({ message: `Unexpected hint from debugger: ${e.body.hintId}, ${e.body.hintId}` });
				}
			}
		});
		let debugSessionStart: Date;
		vs.debug.onDidStartDebugSession((s) => {
			if (s.type === FLUTTER_DEBUG_TYPE) {
				this.currentFlutterDebugSession = s;
				this.resetFlutterSettings();
			}
			if (s.type === FLUTTER_DEBUG_TYPE || s.type === DART_CLI_DEBUG_TYPE) {
				debugSessionStart = new Date();
			}
		});
		vs.debug.onDidTerminateDebugSession((s) => {
			if (s === this.currentFlutterDebugSession) {
				this.currentFlutterDebugSession = null;
			}
			if (s.type === FLUTTER_DEBUG_TYPE || s.type === DART_CLI_DEBUG_TYPE) {
				const debugSessionEnd = new Date();
				analytics.logDebugSessionDuration(debugSessionEnd.getTime() - debugSessionStart.getTime());
			}
		});

		context.subscriptions.push(vs.commands.registerCommand("flutter.toggleDebugPainting", () => this.runBoolServiceCommand("ext.flutter.debugPaint", this.debugPaintingEnabled = !this.debugPaintingEnabled)));
		context.subscriptions.push(vs.commands.registerCommand("flutter.togglePerformanceOverlay", () => this.runBoolServiceCommand("ext.flutter.showPerformanceOverlay", this.performanceOverlayEnabled = !this.performanceOverlayEnabled)));
		context.subscriptions.push(vs.commands.registerCommand("flutter.toggleRepaintRainbow", () => this.runBoolServiceCommand("ext.flutter.repaintRainbow", this.repaintRainbowEnabled = !this.repaintRainbowEnabled)));
		context.subscriptions.push(vs.commands.registerCommand("flutter.toggleSlowAnimations", () => this.runServiceCommand("ext.flutter.timeDilation", { timeDilation: this.timeDilation = 6.0 - this.timeDilation })));
		context.subscriptions.push(vs.commands.registerCommand("flutter.toggleSlowModeBanner", () => this.runBoolServiceCommand("ext.flutter.debugAllowBanner", this.slowModeBannerEnabled = !this.slowModeBannerEnabled)));
		context.subscriptions.push(vs.commands.registerCommand("flutter.togglePaintBaselines", () => this.runBoolServiceCommand("ext.flutter.debugPaintBaselinesEnabled", this.paintBaselinesEnabled = !this.paintBaselinesEnabled)));

		// Open Observatory.
		context.subscriptions.push(vs.commands.registerCommand("dart.openObservatory", () => {
			if (this.observatoryUri) {
				openInBrowser(this.observatoryUri);
				analytics.logDebuggerOpenObservatory();
			}
		}));
		context.subscriptions.push(vs.commands.registerCommand("flutter.openTimeline", () => {
			if (this.observatoryUri) {
				openInBrowser(this.observatoryUri + "/#/timeline-dashboard");
				analytics.logDebuggerOpenTimeline();
			}
		}));

		// Misc custom debug commands.
		context.subscriptions.push(vs.commands.registerCommand("flutter.hotReload", () => {
			this.sendCustomFlutterDebugCommand("hotReload");
			analytics.logDebuggerHotReload();
		}));
		context.subscriptions.push(vs.commands.registerCommand("flutter.fullRestart", () => {
			this.sendCustomFlutterDebugCommand("fullRestart");
			analytics.logDebuggerRestart();
		}));

		// Flutter toggle platform.
		// We can't just use a service command here, as we need to call it twice (once to get, once to change) and
		// currently it seems like the DA can't return responses to us here, so we'll have to do them both inside the DA.
		context.subscriptions.push(vs.commands.registerCommand("flutter.togglePlatform", () => this.sendCustomFlutterDebugCommand("togglePlatform")));
	}

	private promptForFullRestart() {
		const fullRestartText = "Full Restart";
		vs.window.showInformationMessage(
			"Some program elements were changed during reload but did not run when the view was reassembled",
			fullRestartText,
		).then((r) => {
			if (r === fullRestartText)
				this.sendCustomFlutterDebugCommand("fullRestart");
		});
	}

	private runServiceCommand(method: string, params: any) {
		this.sendCustomFlutterDebugCommand("serviceExtension", { type: method, params });
	}

	private runBoolServiceCommand(method: string, enabled: boolean) {
		this.runServiceCommand(method, { enabled });
	}

	private sendCustomFlutterDebugCommand(type: string, args?: any) {
		if (this.currentFlutterDebugSession)
			this.currentFlutterDebugSession.customRequest(type, args);
	}

	public resetFlutterSettings() {
		this.debugPaintingEnabled = false, this.performanceOverlayEnabled = false, this.repaintRainbowEnabled = false, this.timeDilation = 1.0, this.slowModeBannerEnabled = true, this.paintBaselinesEnabled = false;
	}
}
