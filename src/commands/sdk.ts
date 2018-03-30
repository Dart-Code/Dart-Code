import * as child_process from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { ProgressLocation, Uri } from "vscode";
import * as vs from "vscode";
import { Analytics } from "../analytics";
import { config } from "../config";
import { FlutterLaunchRequestArguments, isWin } from "../debug/utils";
import { FlutterDeviceManager } from "../flutter/device_manager";
import { locateBestProjectRoot } from "../project";
import { DartSdkManager, FlutterSdkManager } from "../sdk/sdk_manager";
import { isFlutterWorkspaceFolder, ProjectType, Sdks } from "../utils";
import * as util from "../utils";
import * as channels from "./channels";
import { showFlutterActivationFailure, dartPubPath, flutterPath } from "../sdk/utils";

const flutterNameRegex = new RegExp("^[a-z][a-z0-9_]*$");

export class SdkCommands {
	private sdks: Sdks;
	private analytics: Analytics;
	// A map of any in-progress commands so we can terminate them if we want to run another.
	private runningCommands: { [workspaceUriAndCommand: string]: child_process.ChildProcess; } = {};
	constructor(context: vs.ExtensionContext, sdks: Sdks, analytics: Analytics) {
		this.sdks = sdks;
		this.analytics = analytics;

		const dartSdkManager = new DartSdkManager(sdks);
		context.subscriptions.push(vs.commands.registerCommand("dart.changeSdk", () => dartSdkManager.changeSdk()));
		if (sdks.projectType === ProjectType.Flutter) {
			const flutterSdkManager = new FlutterSdkManager(sdks);
			context.subscriptions.push(vs.commands.registerCommand("dart.changeFlutterSdk", () => flutterSdkManager.changeSdk()));
		}
		context.subscriptions.push(vs.commands.registerCommand("dart.getPackages", async (uri) => {
			if (!uri || !(uri instanceof Uri))
				uri = await this.getWorkspace("Select which folder to get packages for");
			if (typeof uri === "string")
				uri = vs.Uri.file(uri);
			if (isFlutterWorkspaceFolder(vs.workspace.getWorkspaceFolder(uri)))
				return this.runFlutter("packages get", uri);
			else
				return this.runPub("get", uri);
		}));
		context.subscriptions.push(vs.commands.registerCommand("dart.upgradePackages", async (uri) => {
			if (!uri || !(uri instanceof Uri))
				uri = await this.getWorkspace("Select which folder to upgrade packages in");
			if (typeof uri === "string")
				uri = vs.Uri.file(uri);
			if (isFlutterWorkspaceFolder(vs.workspace.getWorkspaceFolder(uri)))
				return this.runFlutter("packages upgrade", uri);
			else
				return this.runPub("upgrade", uri);
		}));

		// Pub commands.
		context.subscriptions.push(vs.commands.registerCommand("pub.get", (selection) => {
			return vs.commands.executeCommand("dart.getPackages", selection);
		}));
		context.subscriptions.push(vs.commands.registerCommand("pub.upgrade", (selection) => {
			return vs.commands.executeCommand("dart.upgradePackages", selection);
		}));

		// Flutter commands.
		context.subscriptions.push(vs.commands.registerCommand("flutter.packages.get", (selection) => {
			return this.runFlutter("packages get", selection);
		}));
		context.subscriptions.push(vs.commands.registerCommand("flutter.packages.upgrade", (selection) => {
			return vs.commands.executeCommand("dart.upgradePackages", selection);
		}));
		context.subscriptions.push(vs.commands.registerCommand("flutter.doctor", (selection) => {
			if (!sdks.flutter) {
				showFlutterActivationFailure("flutter.doctor");
				return;
			}
			const tempDir = path.join(os.tmpdir(), "dart-code-cmd-run");
			if (!fs.existsSync(tempDir))
				fs.mkdirSync(tempDir);
			return this.runFlutterInFolder(tempDir, "doctor", "flutter");
		}));
		context.subscriptions.push(vs.commands.registerCommand("flutter.createProject", (_) => this.createFlutterProject()));
		// Internal command that's fired in user_prompts to actually do the creation.
		context.subscriptions.push(vs.commands.registerCommand("_flutter.create", (projectPath: string) => {
			const projectName = path.basename(projectPath);
			return this.runFlutterInFolder(path.dirname(projectPath), `create ${projectName}`, projectName);
		}));

		// Hook saving pubspec to run pub.get.
		context.subscriptions.push(vs.workspace.onDidSaveTextDocument((td) => {
			if (config.for(td.uri).runPubGetOnPubspecChanges && path.basename(td.fileName).toLowerCase() === "pubspec.yaml")
				vs.commands.executeCommand("dart.getPackages", td.uri);
		}));
	}

	private runCommandForWorkspace(
		handler: (folder: string, command: string, shortPath: string) => Thenable<number>,
		placeHolder: string,
		command: string,
		selection?: vs.Uri,
	): Thenable<number> {

		return this.getWorkspace(placeHolder, selection).then((f) => {
			const workspacePath = vs.workspace.getWorkspaceFolder(vs.Uri.file(f)).uri.fsPath;
			const shortPath = path.join(path.basename(f), path.relative(f, workspacePath));
			return handler(f, command, shortPath);
		});
	}

	private async getWorkspace(placeHolder: string, selection?: vs.Uri): Promise<string> {
		let file = selection && selection.fsPath;
		file = file || (vs.window.activeTextEditor && vs.window.activeTextEditor.document.fileName);
		let folder = file && locateBestProjectRoot(file);

		// If there's only one folder, just use it to avoid prompting the user.
		if (!folder && vs.workspace.workspaceFolders) {
			const allowedProjects = util.getDartWorkspaceFolders();
			if (allowedProjects.length === 1)
				folder = allowedProjects[0].uri.fsPath;
		}

		return folder
			? Promise.resolve(folder)
			// TODO: Can we get this filtered?
			// https://github.com/Microsoft/vscode/issues/39132
			: vs.window.showWorkspaceFolderPick({ placeHolder }).then((f) => f && util.isDartWorkspaceFolder(f) && f.uri.fsPath); // TODO: What if the user didn't pick anything?
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

				const process = util.safeSpawn(folder, binPath, args);
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

	private async createFlutterProject(): Promise<void> {
		if (!this.sdks || !this.sdks.flutter) {
			showFlutterActivationFailure("flutter.newProject");
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

		// Create the empty folder so we can open it.
		fs.mkdirSync(projectFolderUri.fsPath);
		// Create a temp dart file to force extension to load when we open this folder.
		fs.writeFileSync(path.join(projectFolderUri.fsPath, util.FLUTTER_CREATE_PROJECT_TRIGGER_FILE), "");

		const hasFoldersOpen = !!(vs.workspace.workspaceFolders && vs.workspace.workspaceFolders.length);
		const openInNewWindow = hasFoldersOpen;
		vs.commands.executeCommand("vscode.openFolder", projectFolderUri, openInNewWindow);
	}

	private validateFlutterProjectName(input: string) {
		if (!flutterNameRegex.test(input))
			return "Flutter project names should be all lowercase, with underscores to separate words";
		const bannedNames = ["flutter", "flutter_test"];
		if (bannedNames.indexOf(input) !== -1)
			return `You may not use ${input} as the name for a flutter project`;
	}
}
