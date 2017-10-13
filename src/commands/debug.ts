"use strict";

import { analytics } from "../analytics";
import * as channels from "./channels";
import * as child_process from "child_process";
import * as os from "os";
import * as path from "path";
import * as project from "../project";
import * as vs from "vscode";
import { config } from "../config";
import { dartPubPath, isFlutterProject, flutterPath, Sdks } from "../utils";
import { FlutterLaunchRequestArguments, isWin } from "../debug/utils";
import { FlutterDeviceManager } from "../flutter/device_manager";
import { SdkManager } from "../sdk/sdk_manager";
import { FLUTTER_DEBUG_TYPE } from "../providers/debug_config_provider";

export class DebugCommands {
	private debugPaintingEnabled = false;
	private performanceOverlayEnabled = false;
	private repaintRainbowEnabled = false;
	private timeDilation = 1.0;
	private slowModeBannerEnabled = true;
	private paintBaselinesEnabled = false;
	private currentFlutterDebugSession: vs.DebugSession;

	constructor(context: vs.ExtensionContext) {
		vs.debug.onDidStartDebugSession(s => {
			if (s.type == FLUTTER_DEBUG_TYPE) {
				this.currentFlutterDebugSession = s;
				this.resetFlutterSettings();
			}
		});
		vs.debug.onDidTerminateDebugSession(s => {
			if (s == this.currentFlutterDebugSession) {
				this.currentFlutterDebugSession = null;
			}
		});

		context.subscriptions.push(vs.commands.registerCommand("flutter.toggleDebugPainting", () => this.runBoolServiceCommand("ext.flutter.debugPaint", this.debugPaintingEnabled = !this.debugPaintingEnabled)));
		context.subscriptions.push(vs.commands.registerCommand("flutter.togglePerformanceOverlay", () => this.runBoolServiceCommand("ext.flutter.showPerformanceOverlay", this.performanceOverlayEnabled = !this.performanceOverlayEnabled)));
		context.subscriptions.push(vs.commands.registerCommand("flutter.toggleRepaintRainbow", () => this.runBoolServiceCommand("ext.flutter.repaintRainbow", this.repaintRainbowEnabled = !this.repaintRainbowEnabled)));
		context.subscriptions.push(vs.commands.registerCommand("flutter.toggleSlowAnimations", () => this.runServiceCommand("ext.flutter.timeDilation", { timeDilation: this.timeDilation = 6.0 - this.timeDilation })));
		context.subscriptions.push(vs.commands.registerCommand("flutter.toggleSlowModeBanner", () => this.runBoolServiceCommand("ext.flutter.debugAllowBanner", this.slowModeBannerEnabled = !this.slowModeBannerEnabled)));
		context.subscriptions.push(vs.commands.registerCommand("flutter.togglePaintBaselines", () => this.runBoolServiceCommand("ext.flutter.debugPaintBaselinesEnabled", this.paintBaselinesEnabled = !this.paintBaselinesEnabled)));

		// Misc custom debug commands.
		context.subscriptions.push(vs.commands.registerCommand("flutter.fullRestart", () => vs.commands.executeCommand('workbench.customDebugRequest', "fullRestart")));

		// Flutter toggle platform.
		// We can't just use a service command here, as we need to call it twice (once to get, once to change) and
		// currently it seems like the DA can't return responses to us here, so we'll have to do them both inside the DA.
		context.subscriptions.push(vs.commands.registerCommand("flutter.togglePlatform", () => vs.commands.executeCommand('workbench.customDebugRequest', "togglePlatform")));
	}

	private runServiceCommand(method: string, params: any) {
		vs.commands.executeCommand('workbench.customDebugRequest', "serviceExtension", { type: method, params: params });
	}

	private runBoolServiceCommand(method: string, enabled: boolean) {
		this.runServiceCommand(method, { enabled: enabled });
	}

	public resetFlutterSettings() {
		// TODO: Make this better? We need to reset on new debug sessions, but copy/pasting the above is a bit naff.
		this.debugPaintingEnabled = false, this.performanceOverlayEnabled = false, this.repaintRainbowEnabled = false, this.timeDilation = 1.0, this.slowModeBannerEnabled = true, this.paintBaselinesEnabled = false;
	}
}
