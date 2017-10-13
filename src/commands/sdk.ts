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

export class SdkCommands {
	private sdks: Sdks;
	private deviceManager: FlutterDeviceManager;

	constructor(sdks: Sdks, deviceManager: FlutterDeviceManager) {
		this.sdks = sdks;
		this.deviceManager = deviceManager;
	}

	// TODO: This is probably a bad place for these... They were pulled up here and made static as part of moving debug config
	// out from hee to a DebugConfigProvider. Possibly they should all go into the DebugConfigProvider now (which should probably
	// have a Flutter-specific one rather than the if statements in it).
	static debugPaintingEnabled = false;
	static performanceOverlayEnabled = false;
	static repaintRainbowEnabled = false;
	static timeDilation = 1.0;
	static slowModeBannerEnabled = true;
	static paintBaselinesEnabled = false;

	public static resetFlutterSettings() {
		// TODO: Make this better? We need to reset on new debug sessions, but copy/pasting the above is a bit naff.
		this.debugPaintingEnabled = false, this.performanceOverlayEnabled = false, this.repaintRainbowEnabled = false, this.timeDilation = 1.0, this.slowModeBannerEnabled = true, this.paintBaselinesEnabled = false;
	}

	registerCommands(context: vs.ExtensionContext) {
		// SDK commands.
		const sdkManager = new SdkManager();
		context.subscriptions.push(vs.commands.registerCommand("dart.changeSdk", () => sdkManager.changeSdk(this.sdks.dart)));

		// Pub commands.
		context.subscriptions.push(vs.commands.registerCommand("pub.get", selection => {
			if (isFlutterProject) {
				vs.commands.executeCommand("flutter.packages.get");
			} else {
				this.runPub("get", selection);
			}
		}));
		context.subscriptions.push(vs.commands.registerCommand("pub.upgrade", selection => {
			if (isFlutterProject) {
				vs.commands.executeCommand("flutter.packages.upgrade");
			} else {
				this.runPub("upgrade", selection);
			}
		}));

		// Flutter commands.
		context.subscriptions.push(vs.commands.registerCommand("flutter.packages.get", selection => {
			this.runFlutter("packages get");
		}));
		context.subscriptions.push(vs.commands.registerCommand("flutter.packages.upgrade", selection => {
			this.runFlutter("packages upgrade", selection);
		}));
		context.subscriptions.push(vs.commands.registerCommand("flutter.doctor", selection => {
			this.runFlutter("doctor", selection);
		}));

		// Debug service commands.

		context.subscriptions.push(vs.commands.registerCommand("flutter.toggleDebugPainting", () => this.runBoolServiceCommand("ext.flutter.debugPaint", SdkCommands.debugPaintingEnabled = !SdkCommands.debugPaintingEnabled)));
		context.subscriptions.push(vs.commands.registerCommand("flutter.togglePerformanceOverlay", () => this.runBoolServiceCommand("ext.flutter.showPerformanceOverlay", SdkCommands.performanceOverlayEnabled = !SdkCommands.performanceOverlayEnabled)));
		context.subscriptions.push(vs.commands.registerCommand("flutter.toggleRepaintRainbow", () => this.runBoolServiceCommand("ext.flutter.repaintRainbow", SdkCommands.repaintRainbowEnabled = !SdkCommands.repaintRainbowEnabled)));
		context.subscriptions.push(vs.commands.registerCommand("flutter.toggleSlowAnimations", () => this.runServiceCommand("ext.flutter.timeDilation", { timeDilation: SdkCommands.timeDilation = 6.0 - SdkCommands.timeDilation })));
		context.subscriptions.push(vs.commands.registerCommand("flutter.toggleSlowModeBanner", () => this.runBoolServiceCommand("ext.flutter.debugAllowBanner", SdkCommands.slowModeBannerEnabled = !SdkCommands.slowModeBannerEnabled)));
		context.subscriptions.push(vs.commands.registerCommand("flutter.togglePaintBaselines", () => this.runBoolServiceCommand("ext.flutter.debugPaintBaselinesEnabled", SdkCommands.paintBaselinesEnabled = !SdkCommands.paintBaselinesEnabled)));

		// Misc custom debug commands.
		context.subscriptions.push(vs.commands.registerCommand("flutter.fullRestart", () => vs.commands.executeCommand('workbench.customDebugRequest', "fullRestart")));

		// Flutter toggle platform.
		// We can't just use a service command here, as we need to call it twice (once to get, once to change) and
		// currently it seems like the DA can't return responses to us here, so we'll have to do them both inside the DA.
		context.subscriptions.push(vs.commands.registerCommand("flutter.togglePlatform", () => vs.commands.executeCommand('workbench.customDebugRequest', "togglePlatform")));

		// Hook saving pubspec to run pub.get.
		context.subscriptions.push(vs.workspace.onDidSaveTextDocument(td => {
			if (config.runPubGetOnPubspecChanges && path.basename(td.fileName).toLowerCase() == "pubspec.yaml")
				vs.commands.executeCommand("pub.get", td.uri);
		}));
	}

	private runServiceCommand(method: string, params: any) {
		vs.commands.executeCommand('workbench.customDebugRequest', "serviceExtension", { type: method, params: params });
	}

	private runBoolServiceCommand(method: string, enabled: boolean) {
		this.runServiceCommand(method, { enabled: enabled });
	}

	private runFlutter(command: string, selection?: vs.Uri) {
		let root = vs.workspace.rootPath;
		let projectPath = selection
			? path.dirname(selection.fsPath)
			: project.locateBestProjectRoot();
		let shortPath = path.join(path.basename(root), path.relative(root, projectPath));
		let channel = channels.createChannel("Flutter");
		channel.show(true);

		let args = new Array();
		command.split(' ').forEach(option => {
			args.push(option);
		});

		let flutterBinPath = path.join(this.sdks.flutter, flutterPath);
		channel.appendLine(`[${shortPath}] flutter ${args.join(" ")}`);

		let process = child_process.spawn(flutterBinPath, args, { "cwd": projectPath });
		channels.runProcessInChannel(process, channel);
	}

	private runPub(command: string, selection?: vs.Uri) {
		let root = vs.workspace.rootPath;
		let projectPath = selection
			? path.dirname(selection.fsPath)
			: project.locateBestProjectRoot();
		let shortPath = path.join(path.basename(root), path.relative(root, projectPath));
		let channel = channels.createChannel("Pub");
		channel.show(true);

		let args = [];
		args.push(command);

		// Allow arbitrary args to be passed.
		if (config.pubAdditionalArgs)
			args = args.concat(config.pubAdditionalArgs);

		// TODO: Add a wrapper around the Dart SDK? It could do things like
		// return the paths for tools in the bin/ dir. 
		let pubPath = path.join(this.sdks.dart, dartPubPath);
		channel.appendLine(`[${shortPath}] pub ${args.join(" ")}`);

		let process = child_process.spawn(pubPath, args, { "cwd": projectPath });
		channels.runProcessInChannel(process, channel);
	}
}
