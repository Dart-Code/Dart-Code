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

export class SdkCommands {
	private sdks: Sdks;

	constructor(sdks: Sdks) {
		this.sdks = sdks;
	}

	registerCommands(context: vs.ExtensionContext) {
		function setupDebugConfig(debugConfig: FlutterLaunchRequestArguments, sdks: Sdks) {
			analytics.logDebuggerStart();

			const dartExec = isWin ? "dart.exe" : "dart";
			const flutterExec = isWin ? "flutter.bat" : "flutter";

			// Attach any properties that weren't explicitly set.
			debugConfig.cwd = debugConfig.cwd || "${workspaceRoot}";
			debugConfig.args = debugConfig.args || [];
			debugConfig.dartPath = debugConfig.dartPath || path.join(sdks.dart, "bin", dartExec);
			debugConfig.flutterPath = debugConfig.flutterPath || (sdks.flutter ? path.join(sdks.flutter, "bin", flutterExec) : null);
			debugConfig.flutterRunLogFile = debugConfig.flutterRunLogFile || config.flutterRunLogFile;
			debugConfig.debugSdkLibraries = debugConfig.debugSdkLibraries || config.debugSdkLibraries;
			debugConfig.debugExternalLibraries = debugConfig.debugExternalLibraries || config.debugExternalLibraries;
			if (debugConfig.checkedMode === undefined)
				debugConfig.checkedMode = true;
		}

		// Debug commands.
		context.subscriptions.push(vs.commands.registerCommand("dart.startDebugSession", (debugConfig: FlutterLaunchRequestArguments) => {
			if (Object.keys(debugConfig).length === 0)
				return { status: 'initialConfiguration' };

			setupDebugConfig(debugConfig, this.sdks);

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

		context.subscriptions.push(vs.commands.registerCommand("flutter.packages.get", selection => {
			this.runFlutter("packages get");
		}));
		context.subscriptions.push(vs.commands.registerCommand("flutter.packages.upgrade", selection => {
			this.runFlutter("packages upgrade", selection);
		}));

		// Hook saving pubspec to run pub.get.
		context.subscriptions.push(vs.workspace.onDidSaveTextDocument(td => {
			if (config.runPubGetOnPubspecChanges && path.basename(td.fileName).toLowerCase() == "pubspec.yaml")
				vs.commands.executeCommand("pub.get", td.uri);
		}));
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
