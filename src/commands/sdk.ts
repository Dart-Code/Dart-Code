"use strict";

import { Analytics } from "../analytics";
import * as channels from "./channels";
import * as child_process from "child_process";
import * as os from "os";
import * as path from "path";
import { locateBestProjectRoot } from "../project";
import * as vs from "vscode";
import { config } from "../config";
import { dartPubPath, flutterPath, getDartWorkspaceFolders, isDartWorkspaceFolder, ProjectType, Sdks, isFlutterProject } from "../utils";
import { FlutterLaunchRequestArguments, isWin } from "../debug/utils";
import { FlutterDeviceManager } from "../flutter/device_manager";
import { SdkManager } from "../sdk/sdk_manager";
import { Uri } from "vscode";

export class SdkCommands {
	private sdks: Sdks;
	private analytics: Analytics;
	constructor(context: vs.ExtensionContext, sdks: Sdks, analytics: Analytics) {
		this.sdks = sdks;
		this.analytics = analytics;
		// SDK commands.
		const sdkManager = new SdkManager(sdks);
		context.subscriptions.push(vs.commands.registerCommand("dart.changeSdk", () => sdkManager.changeSdk()));
		context.subscriptions.push(vs.commands.registerCommand("dart.fetchPackages", (uri) => {
			if (!uri || !(uri instanceof Uri))
				return;
			if (isFlutterProject(vs.workspace.getWorkspaceFolder(uri)))
				return vs.commands.executeCommand("flutter.packages.get", uri);
			else
				return vs.commands.executeCommand("pub.get", uri);
		}));

		// Pub commands.
		context.subscriptions.push(vs.commands.registerCommand("pub.get", (selection) => {
			return this.runPub("get", selection);
		}));
		context.subscriptions.push(vs.commands.registerCommand("pub.upgrade", (selection) => {
			return this.runPub("upgrade", selection);
		}));

		// Flutter commands.
		context.subscriptions.push(vs.commands.registerCommand("flutter.packages.get", (selection) => {
			return this.runFlutter("packages get", selection);
		}));
		context.subscriptions.push(vs.commands.registerCommand("flutter.packages.upgrade", (selection) => {
			return this.runFlutter("packages upgrade", selection);
		}));
		context.subscriptions.push(vs.commands.registerCommand("flutter.doctor", (selection) => {
			return this.runFlutter("doctor", selection);
		}));

		// Hook saving pubspec to run pub.get.
		context.subscriptions.push(vs.workspace.onDidSaveTextDocument((td) => {
			if (config.for(td.uri).runPubGetOnPubspecChanges && path.basename(td.fileName).toLowerCase() === "pubspec.yaml")
				vs.commands.executeCommand("dart.fetchPackages", td.uri);
		}));
	}

	private runCommandForWorkspace(
		handler: (folder: string, command: string, shortPath: string) => Thenable<number>,
		placeHolder: string,
		command: string,
		selection?: vs.Uri,
	): Thenable<number> {
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

		return folderPromise.then((f) => {
			const workspacePath = vs.workspace.getWorkspaceFolder(vs.Uri.file(f)).uri.fsPath;
			const shortPath = path.join(path.basename(f), path.relative(f, workspacePath));
			return handler(f, command, shortPath);
		});
	}

	private runFlutter(command: string, selection?: vs.Uri): Thenable<number> {
		return this.runCommandForWorkspace(this.runFlutterInFolder.bind(this), `Select the folder to run "flutter ${command}" in`, command, selection);
	}

	private runFlutterInFolder(folder: string, command: string, shortPath: string): Thenable<number> {
		return new Promise((resolve, reject) => {
			const binPath = path.join(this.sdks.flutter, flutterPath);
			const args = command.split(" ");
			this.runCommandInFolder(shortPath, "flutter", folder, binPath, args, resolve);
		});
	}

	private runPub(command: string, selection?: vs.Uri): Thenable<number> {
		return this.runCommandForWorkspace(this.runPubInFolder.bind(this), `Select the folder to run "pub ${command}" in`, command, selection);
	}

	private runPubInFolder(folder: string, command: string, shortPath: string): Thenable<number> {
		return new Promise((resolve, reject) => {
			const binPath = path.join(this.sdks.dart, dartPubPath);
			const args = command.split(" ").concat(...config.for(vs.Uri.file(folder)).pubAdditionalArgs);
			this.runCommandInFolder(shortPath, "pub", folder, binPath, args, resolve);
		});
	}

	private runCommandInFolder(shortPath: string, commandName: string, folder: string, binPath: string, args: string[], closeHandler: (code: number) => void) {
		const channelName = commandName.substr(0, 1).toUpperCase() + commandName.substr(1);
		const channel = channels.createChannel(channelName);
		channel.show(true);

		channel.clear();

		channel.appendLine(`[${shortPath}] ${commandName} ${args.join(" ")}`);

		const process = child_process.spawn(binPath, args, { cwd: folder });
		channels.runProcessInChannel(process, channel);

		process.on("close", (code) => closeHandler(code));
	}
}
