"use strict";

import { analytics } from "../analytics";
import * as channels from "./channels";
import * as child_process from "child_process";
import * as os from "os";
import * as path from "path";
import * as project from "../project";
import * as vs from "vscode";
import { config } from "../config";
import { dartPubPath, flutterPath, sdks } from "../utils";
import { FlutterLaunchRequestArguments, isWin } from "../debug/utils";
import { FlutterDeviceManager } from "../flutter/device_manager";
import { SdkManager } from "../sdk/sdk_manager";

export class SdkCommands {
	constructor(context: vs.ExtensionContext) {
		// SDK commands.
		const sdkManager = new SdkManager();
		context.subscriptions.push(vs.commands.registerCommand("dart.changeSdk", () => sdkManager.changeSdk()));

		// Pub commands.
		context.subscriptions.push(vs.commands.registerCommand("pub.get", selection => {
			this.runPub("get", selection);
		}));
		context.subscriptions.push(vs.commands.registerCommand("pub.upgrade", selection => {
			this.runPub("upgrade", selection);
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

		// Hook saving pubspec to run pub.get.
		context.subscriptions.push(vs.workspace.onDidSaveTextDocument(td => {
			if (config.runPubGetOnPubspecChanges && path.basename(td.fileName).toLowerCase() == "pubspec.yaml")
				vs.commands.executeCommand("pub.get", td.uri);
		}));
	}


	private runCommandForWorkspace(
		handler: (folder: string, command: string) => void,
		placeHolder: string,
		command: string,
		selection?: vs.Uri
	) {
		let folder = selection && vs.workspace.getWorkspaceFolder(selection);

		// If there's only one folder, just use it to avoid prompting the user.
		if (!folder && vs.workspace.workspaceFolders) {
			// TODO: Filter to Dart or Flutter projects.
			const allowedProjects = vs.workspace.workspaceFolders.filter(f => f.uri.scheme == "file");
			if (allowedProjects.length == 1)
				folder = allowedProjects[0];
		}

		const folderPromise =
			folder
				? Promise.resolve(folder)
				// TODO: Can we get this filtered?
				// https://github.com/Microsoft/vscode/issues/39132
				: vs.window.showWorkspaceFolderPick({ placeHolder: placeHolder });

		folderPromise
			.then(f => {
				if (f && f.uri.scheme == "file") {
					handler(f.uri.fsPath, command);
				}
			});
	}

	private runFlutter(command: string, selection?: vs.Uri) {
		this.runCommandForWorkspace(this.runFlutterInFolder, `Select the folder to run "flutter ${command}" in`, command, selection);
	}

	private runFlutterInFolder(folder: string, command: string) {
		let projectPath = project.locateBestProjectRoot(folder);
		let shortPath = path.join(path.basename(folder), path.relative(folder, projectPath));
		let channel = channels.createChannel("Flutter");
		channel.show(true);

		let args = new Array();
		command.split(' ').forEach(option => {
			args.push(option);
		});

		let flutterBinPath = path.join(sdks.flutter, flutterPath);
		channel.appendLine(`[${shortPath}] flutter ${args.join(" ")}`);

		let process = child_process.spawn(flutterBinPath, args, { "cwd": projectPath });
		channels.runProcessInChannel(process, channel);
	}

	private runPub(command: string, selection?: vs.Uri) {
		this.runCommandForWorkspace(this.runPubInFolder, `Select the folder to run "pub ${command}" in`, command, selection);
	}

	private runPubInFolder(folder: string, command: string) {
		let projectPath = project.locateBestProjectRoot(folder);
		let shortPath = path.join(path.basename(folder), path.relative(folder, projectPath));
		let channel = channels.createChannel("Pub");
		channel.show(true);

		let args = [];
		args.push(command);

		// Allow arbitrary args to be passed.
		if (config.pubAdditionalArgs)
			args = args.concat(config.pubAdditionalArgs);

		// TODO: Add a wrapper around the Dart SDK? It could do things like
		// return the paths for tools in the bin/ dir. 
		let pubPath = path.join(sdks.dart, dartPubPath);
		channel.appendLine(`[${shortPath}] pub ${args.join(" ")}`);

		let process = child_process.spawn(pubPath, args, { "cwd": projectPath });
		channels.runProcessInChannel(process, channel);
	}
}
