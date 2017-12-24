"use strict";

import { Analytics } from "../analytics";
import * as channels from "./channels";
import * as child_process from "child_process";
import * as os from "os";
import * as path from "path";
import { locateBestProjectRoot } from "../project";
import * as vs from "vscode";
import { config } from "../config";
import { dartPubPath, flutterPath, getDartWorkspaceFolders, isDartWorkspaceFolder, ProjectType, Sdks } from "../utils";
import { FlutterLaunchRequestArguments, isWin } from "../debug/utils";
import { FlutterDeviceManager } from "../flutter/device_manager";
import { SdkManager } from "../sdk/sdk_manager";

export class SdkCommands {
	private sdks: Sdks;
	private analytics: Analytics;
	constructor(context: vs.ExtensionContext, sdks: Sdks, analytics: Analytics) {
		this.sdks = sdks;
		this.analytics = analytics;
		// SDK commands.
		const sdkManager = new SdkManager(sdks);
		context.subscriptions.push(vs.commands.registerCommand("dart.changeSdk", () => sdkManager.changeSdk()));

		// Pub commands.
		context.subscriptions.push(vs.commands.registerCommand("pub.get", (selection) => {
			this.runPub("get", selection);
		}));
		context.subscriptions.push(vs.commands.registerCommand("pub.upgrade", (selection) => {
			this.runPub("upgrade", selection);
		}));

		// Flutter commands.
		context.subscriptions.push(vs.commands.registerCommand("flutter.packages.get", (selection) => {
			this.runFlutter("packages get");
		}));
		context.subscriptions.push(vs.commands.registerCommand("flutter.packages.upgrade", (selection) => {
			this.runFlutter("packages upgrade", selection);
		}));
		context.subscriptions.push(vs.commands.registerCommand("flutter.doctor", (selection) => {
			this.runFlutter("doctor", selection);
		}));

		// Hook saving pubspec to run pub.get.
		context.subscriptions.push(vs.workspace.onDidSaveTextDocument((td) => {
			if (config.for(td.uri).runPubGetOnPubspecChanges && path.basename(td.fileName).toLowerCase() === "pubspec.yaml") {
				if (sdks.projectType === ProjectType.Flutter || sdks.projectType === ProjectType.Fuchsia) {
					vs.commands.executeCommand("flutter.packages.get");
				} else {
					vs.commands.executeCommand("pub.get", td.uri);
				}
			}
		}));
	}

	private runCommandForWorkspace(
		handler: (folder: string, command: string, shortPath: string) => void,
		placeHolder: string,
		command: string,
		selection?: vs.Uri,
	) {
		let file = selection && selection.fsPath;
		file = file || (vs.window.activeTextEditor && vs.window.activeTextEditor.document.fileName);
		let folder = file && locateBestProjectRoot(file);

		// If there's only one folder, just use it to avoid prompting the user.
		if (!folder && vs.workspace.workspaceFolders) {
			// TODO: Filter to Dart or Flutter projects.
			const allowedProjects = getDartWorkspaceFolders();
			if (allowedProjects.length === 1)
				folder = allowedProjects[0].uri.fsPath;
		}

		const folderPromise =
			folder
				? Promise.resolve(folder)
				// TODO: Can we get this filtered?
				// https://github.com/Microsoft/vscode/issues/39132
				: vs.window.showWorkspaceFolderPick({ placeHolder }).then((f) => f && isDartWorkspaceFolder(f) && f.uri.fsPath);

		folderPromise.then((f) => {
			const workspacePath = vs.workspace.getWorkspaceFolder(vs.Uri.file(f)).uri.fsPath;
			const shortPath = path.join(path.basename(f), path.relative(f, workspacePath));
			handler(f, command, shortPath);
		});
	}

	private runFlutter(command: string, selection?: vs.Uri) {
		this.runCommandForWorkspace(this.runFlutterInFolder.bind(this), `Select the folder to run "flutter ${command}" in`, command, selection);
	}

	private runFlutterInFolder(folder: string, command: string, shortPath: string) {
		const channel = channels.createChannel("Flutter");
		channel.show(true);

		const args = new Array();
		command.split(" ").forEach((option) => {
			args.push(option);
		});

		const flutterBinPath = path.join(this.sdks.flutter, flutterPath);
		channel.appendLine(`[${shortPath}] flutter ${args.join(" ")}`);

		const process = child_process.spawn(flutterBinPath, args, { cwd: folder });
		channels.runProcessInChannel(process, channel);
	}

	private runPub(command: string, selection?: vs.Uri) {
		this.runCommandForWorkspace(this.runPubInFolder.bind(this), `Select the folder to run "pub ${command}" in`, command, selection);
	}

	private runPubInFolder(folder: string, command: string, shortPath: string) {
		const channel = channels.createChannel("Pub");
		channel.show(true);

		let args = [];
		args.push(command);

		// Allow arbitrary args to be passed.
		if (config.for(vs.Uri.file(folder)).pubAdditionalArgs)
			args = args.concat(config.for(vs.Uri.file(folder)).pubAdditionalArgs);

		// TODO: Add a wrapper around the Dart SDK? It could do things like
		// return the paths for tools in the bin/ dir.
		const pubPath = path.join(this.sdks.dart, dartPubPath);
		channel.appendLine(`[${shortPath}] pub ${args.join(" ")}`);

		const process = child_process.spawn(pubPath, args, { cwd: folder });
		channels.runProcessInChannel(process, channel);
	}
}
