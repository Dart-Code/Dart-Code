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

	registerCommands(context: vs.ExtensionContext) {
		function setupDebugConfig(debugConfig: FlutterLaunchRequestArguments, sdks: Sdks, deviceId: string) {
			analytics.logDebuggerStart();

			const dartExec = isWin ? "dart.exe" : "dart";
			const flutterExec = isWin ? "flutter.bat" : "flutter";

			// Attach any properties that weren't explicitly set.
			debugConfig.cwd = debugConfig.cwd || "${workspaceRoot}";
			debugConfig.args = debugConfig.args || [];
			debugConfig.dartPath = debugConfig.dartPath || path.join(sdks.dart, "bin", dartExec);
			debugConfig.observatoryLogFile = debugConfig.observatoryLogFile || config.observatoryLogFile;
			debugConfig.debugSdkLibraries = debugConfig.debugSdkLibraries || config.debugSdkLibraries;
			debugConfig.debugExternalLibraries = debugConfig.debugExternalLibraries || config.debugExternalLibraries;
			if (debugConfig.checkedMode === undefined)
				debugConfig.checkedMode = true;
			debugConfig.flutterPath = debugConfig.flutterPath || (sdks.flutter ? path.join(sdks.flutter, "bin", flutterExec) : null);
			debugConfig.flutterRunLogFile = debugConfig.flutterRunLogFile || config.flutterRunLogFile;
			debugConfig.deviceId = debugConfig.deviceId || deviceId;
		}

		// SDK commands.
		const sdkManager = new SdkManager();
		context.subscriptions.push(vs.commands.registerCommand("dart.changeSdk", () => sdkManager.changeSdk(this.sdks.dart)));

		// Debug commands.
		context.subscriptions.push(vs.commands.registerCommand("_dart.startDebugSession", (debugConfig: FlutterLaunchRequestArguments) => {
			const keys = Object.keys(debugConfig);
			if (keys.length == 0 || (keys.length == 1 && keys[0] == "noDebug"))
				return { status: 'initialConfiguration' };

			setupDebugConfig(debugConfig, this.sdks, this.deviceManager && this.deviceManager.currentDevice ? this.deviceManager.currentDevice.id : null);

			if (isFlutterProject)
				debugConfig.program = debugConfig.program || "${workspaceRoot}/lib/main.dart";

			vs.commands.executeCommand('vscode.startDebug', debugConfig);
			return { status: 'ok' };
		}));

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
		let debugPaintingEnabled = false, performanceOverlayEnabled = false, repaintRainbowEnabled = false, timeDilation = 1.0;
		context.subscriptions.push(vs.commands.registerCommand("flutter.toggleDebugPainting", () => this.runBoolServiceCommand("ext.flutter.debugPaint", debugPaintingEnabled = !debugPaintingEnabled)));
		context.subscriptions.push(vs.commands.registerCommand("flutter.togglePerformanceOverlay", () => this.runBoolServiceCommand("ext.flutter.showPerformanceOverlay", performanceOverlayEnabled = !performanceOverlayEnabled)));
		context.subscriptions.push(vs.commands.registerCommand("flutter.toggleRepaintRainbow", () => this.runBoolServiceCommand("ext.flutter.repaintRainbow", repaintRainbowEnabled = !repaintRainbowEnabled)));
		context.subscriptions.push(vs.commands.registerCommand("flutter.toggleSlowAnimations", () => this.runServiceCommand("ext.flutter.timeDilation", { timeDilation: timeDilation = 6.0 - timeDilation })));

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
