"use strict";

import { Analytics } from "../analytics";
import { config } from "../config";
import { dartPubPath, flutterPath, getDartWorkspaceFolders, isDartWorkspaceFolder, ProjectType, Sdks, isFlutterProject } from "../utils";
import { FLUTTER_DOWNLOAD_URL } from "../extension";
import { FlutterDeviceManager } from "../flutter/device_manager";
import { FlutterLaunchRequestArguments, isWin } from "../debug/utils";
import { locateBestProjectRoot } from "../project";
import { SdkManager } from "../sdk/sdk_manager";
import { Uri, ProgressLocation } from "vscode";
import * as channels from "./channels";
import * as child_process from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as util from "../utils";
import * as vs from "vscode";

const flutterNameRegex = new RegExp("^[a-z][a-z0-9_]*$");

export class SdkCommands {
	private sdks: Sdks;
	private analytics: Analytics;
	// A map of any in-progress commands so we can terminate them if we want to run another.
	private runningCommands: { [workspaceUriAndCommand: string]: child_process.ChildProcess; } = {};
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
		context.subscriptions.push(vs.commands.registerCommand("flutter.createProject", (_) => this.createFlutterProject(context)));

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
		const binPath = path.join(this.sdks.flutter, flutterPath);
		const args = command.split(" ");
		return this.runCommandInFolder(shortPath, "flutter", folder, binPath, args);
	}

	private runPub(command: string, selection?: vs.Uri): Thenable<number> {
		return this.runCommandForWorkspace(this.runPubInFolder.bind(this), `Select the folder to run "pub ${command}" in`, command, selection);
	}

	private runPubInFolder(folder: string, command: string, shortPath: string): Thenable<number> {
		const binPath = path.join(this.sdks.dart, dartPubPath);
		const args = command.split(" ").concat(...config.for(vs.Uri.file(folder)).pubAdditionalArgs);
		return this.runCommandInFolder(shortPath, "pub", folder, binPath, args);
	}

	private runCommandInFolder(shortPath: string, commandName: string, folder: string, binPath: string, args: string[], isStartingBecauseOfTermination: boolean = false): Thenable<number> {
		return vs.window.withProgress({ location: ProgressLocation.Window, title: `Running ${commandName} ${args.join(" ")}` }, (progress) => {
			return new Promise((resolve, reject) => {
				const channelName = commandName.substr(0, 1).toUpperCase() + commandName.substr(1);
				const channel = channels.createChannel(channelName);
				channel.show(true);

				// Create an ID to use so we can look whether there's already a running process for this command to terminate/restart.
				const commandId = `${folder}|${commandName}|${args}`;

				const existingProcess = this.runningCommands[commandId];
				if (existingProcess) {
					channel.appendLine(`${commandName} ${args.join(" ")} was already running; terminating…`);

					// Queue up a request to re-do this when it terminates
					// Wrap in a setTimeout to ensure all the other close handlers are processed (such as writing that the process
					// exited) before we start up.
					existingProcess.on("close", () => this.runCommandInFolder(shortPath, commandName, folder, binPath, args, true).then(resolve, reject));
					existingProcess.kill();

					this.runningCommands[commandId] = null;
					return;
				} else if (!isStartingBecauseOfTermination) {
					channel.clear();
				}

				channel.appendLine(`[${shortPath}] ${commandName} ${args.join(" ")}`);

				const process = child_process.spawn(binPath, args, { cwd: folder });
				this.runningCommands[commandId] = process;
				process.on("close", (code) => {
					// Check it's still the same process before nulling out, in case our replacement has already been inserted.
					if (this.runningCommands[commandId] === process)
						this.runningCommands[commandId] = null;
				});
				process.on("close", (code) => resolve(code));
				channels.runProcessInChannel(process, channel);
			});
		});
	}

	private async createFlutterProject(context: vs.ExtensionContext): Promise<number> {
		if (!this.sdks || !this.sdks.flutter) {
			vs.window.showErrorMessage("Could not find a Flutter SDK to use. " +
				"Please add it to your PATH, set FLUTTER_ROOT or configure the 'dart.flutterSdkPath' setting and try again.",
				"Go to Flutter Downloads",
			).then((selectedItem) => {
				if (selectedItem)
					util.openInBrowser(FLUTTER_DOWNLOAD_URL);
			});
			return;
		}

		const name = await vs.window.showInputBox({ prompt: "Enter a name for your new project", placeHolder: "hello_world", validateInput: this.validateFlutterProjectName });
		if (!name)
			return;

		// If already in a workspace, set the default folder to somethign nearby.
		const folders = await vs.window.showOpenDialog({ canSelectFolders: true, openLabel: "Select a folder to create the project in" });
		if (!folders || folders.length !== 1)
			return;
		const folderUri = folders[0];
		const projectFolderUri = Uri.file(path.join(folderUri.fsPath, name));

		if (fs.existsSync(projectFolderUri.fsPath)) {
			vs.window.showErrorMessage(`A folder named ${name} already exists in ${folderUri.fsPath}`);
			return;
		}

		const code = await this.runFlutterInFolder(folderUri.fsPath, `create ${name}`, path.basename(folderUri.fsPath));

		this.prepareProjectFolder(context, projectFolderUri.fsPath);

		if (code === 0) {
			const hasFoldersOpen = !!(vs.workspace.workspaceFolders && vs.workspace.workspaceFolders.length);
			const openInNewWindow = hasFoldersOpen;
			vs.commands.executeCommand("vscode.openFolder", projectFolderUri, openInNewWindow);
		}
	}

	private validateFlutterProjectName(input: string) {
		if (!flutterNameRegex.test(input))
			return "Flutter project names should be all lowercase, with underscores to separate words";
	}

	private prepareProjectFolder(context: vs.ExtensionContext, projectFolder: string) {
		// Tidy up the folder for VS Code user.
		try {
			util.deleteFolderRecursively(path.join(projectFolder, ".idea"));
			util.deleteFilesByExtensionRecursively(projectFolder, "iml");
		} catch { }

		// Stash the path to this new project in context and when we open it up we can perform some welcome actions.
		// TODO: Wrap this!
		context.globalState.update("newFlutterProject", projectFolder);
	}
}
