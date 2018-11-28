import * as child_process from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vs from "vscode";
import { ProgressLocation, Uri, window } from "vscode";
import { Analytics } from "../analytics";
import { config } from "../config";
import { globalFlutterArgs, PromiseCompleter, safeSpawn } from "../debug/utils";
import { FlutterDeviceManager } from "../flutter/device_manager";
import { locateBestProjectRoot } from "../project";
import { DartHoverProvider } from "../providers/dart_hover_provider";
import { DartSdkManager, FlutterSdkManager } from "../sdk/sdk_manager";
import { flutterPath, pubPath, showFlutterActivationFailure } from "../sdk/utils";
import * as util from "../utils";
import { fsPath, ProjectType, Sdks } from "../utils";
import * as channels from "./channels";

const flutterNameRegex = new RegExp("^[a-z][a-z0-9_]*$");

export class SdkCommands {
	private flutterScreenshotPath?: string;
	// A map of any in-progress commands so we can terminate them if we want to run another.
	private runningCommands: { [workspaceUriAndCommand: string]: ChainedProcess | undefined; } = {};

	constructor(context: vs.ExtensionContext, private sdks: Sdks, private analytics: Analytics, private deviceManager: FlutterDeviceManager) {
		this.sdks = sdks;
		this.analytics = analytics;

		const dartSdkManager = new DartSdkManager(sdks);
		context.subscriptions.push(vs.commands.registerCommand("dart.changeSdk", () => dartSdkManager.changeSdk()));
		if (sdks.projectType === ProjectType.Flutter) {
			const flutterSdkManager = new FlutterSdkManager(sdks);
			context.subscriptions.push(vs.commands.registerCommand("dart.changeFlutterSdk", () => flutterSdkManager.changeSdk()));
		}
		context.subscriptions.push(vs.commands.registerCommand("dart.getPackages", async (uri: string | Uri) => {
			if (!uri || !(uri instanceof Uri))
				uri = await this.getFolderToRunCommandIn("Select which folder to get packages for");
			if (typeof uri === "string")
				uri = vs.Uri.file(uri);
			try {
				if (util.isInsideFlutterProject(uri))
					return this.runFlutter(["packages", "get"], uri);
				else
					return this.runPub(["get"], uri);
			} finally {
				// TODO: Move this to a reusable event.
				DartHoverProvider.clearPackageMapCaches();
			}
		}));
		context.subscriptions.push(vs.commands.registerCommand("dart.upgradePackages", async (uri: string | Uri) => {
			if (!uri || !(uri instanceof Uri))
				uri = await this.getFolderToRunCommandIn("Select which folder to upgrade packages in");
			if (typeof uri === "string")
				uri = vs.Uri.file(uri);
			if (util.isInsideFlutterProject(uri))
				return this.runFlutter(["packages", "upgrade"], uri);
			else
				return this.runPub(["upgrade"], uri);
		}));

		// Pub commands.
		context.subscriptions.push(vs.commands.registerCommand("pub.get", (selection) => {
			return vs.commands.executeCommand("dart.getPackages", selection);
		}));
		context.subscriptions.push(vs.commands.registerCommand("pub.upgrade", (selection) => {
			return vs.commands.executeCommand("dart.upgradePackages", selection);
		}));

		// Flutter commands.
		context.subscriptions.push(vs.commands.registerCommand("flutter.packages.get", async (selection): Promise<number> => {
			if (!selection)
				selection = vs.Uri.file(await this.getFolderToRunCommandIn(`Select the folder to run "flutter packages get" in`, selection));

			// If we're working on the flutter repository, map this on to update-packages.
			if (selection && fsPath(selection) === sdks.flutter) {
				return this.runFlutter(["update-packages"], selection);
			}

			try {
				return this.runFlutter(["packages", "get"], selection);
			} finally {
				// TODO: Move this to a reusable event.
				DartHoverProvider.clearPackageMapCaches();
			}
		}));
		context.subscriptions.push(vs.commands.registerCommand("flutter.screenshot", async (uri) => {
			let shouldNotify = false;
			// TODO: Why do we do this? What is the uri used for?!
			if (!uri || !(uri instanceof Uri)) {

				// If there is no path for this session, or it differs from config, use the one from config.
				if (!this.flutterScreenshotPath ||
					(config.flutterScreenshotPath && this.flutterScreenshotPath !== config.flutterScreenshotPath)) {
					this.flutterScreenshotPath = config.flutterScreenshotPath;
					shouldNotify = true;
				}

				// If path is still empty, bring up the folder selector.
				if (!this.flutterScreenshotPath) {
					const selectedFolder =
						await window.showOpenDialog({ canSelectFolders: true, openLabel: "Set screenshots folder" });
					if (selectedFolder && selectedFolder.length > 0) {
						// Set variable to selected path. This allows prompting the user only once.
						this.flutterScreenshotPath = selectedFolder[0].path;
						shouldNotify = true;
					} else {
						// Do nothing if the user cancelled the folder selection.
						return;
					}
				}

				// Ensure folder exists.
				util.mkDirRecursive(this.flutterScreenshotPath);
			}

			const deviceId = this.deviceManager && this.deviceManager.currentDevice ? this.deviceManager.currentDevice.id : null;
			const args = deviceId ? ["screenshot", "-d", deviceId] : ["screenshot"];
			await this.runFlutterInFolder(this.flutterScreenshotPath, args, "screenshot");

			if (shouldNotify) {
				const res = await vs.window.showInformationMessage(`Screenshots will be saved to ${this.flutterScreenshotPath}`, "Show Folder");
				if (res)
					await vs.commands.executeCommand("revealFileInOS", Uri.file(this.flutterScreenshotPath));
			}
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
			return this.runFlutterInFolder(tempDir, ["doctor"], "flutter");
		}));
		context.subscriptions.push(vs.commands.registerCommand("flutter.upgrade", async (selection) => {
			if (!sdks.flutter) {
				showFlutterActivationFailure("flutter.upgrade");
				return;
			}
			const tempDir = path.join(os.tmpdir(), "dart-code-cmd-run");
			if (!fs.existsSync(tempDir))
				fs.mkdirSync(tempDir);
			await this.runFlutterInFolder(tempDir, ["upgrade"], "flutter");
			await util.reloadExtension();
		}));
		context.subscriptions.push(vs.commands.registerCommand("flutter.createProject", (_) => this.createFlutterProject()));
		// Internal command that's fired in user_prompts to actually do the creation.
		context.subscriptions.push(vs.commands.registerCommand("_flutter.create", (projectPath: string, projectName?: string) => {
			projectName = projectName || path.basename(projectPath);
			const args = ["create"];
			if (config.flutterCreateOrganization) {
				args.push("--org");
				args.push(config.flutterCreateOrganization);
			}
			if (config.flutterCreateIOSLanguage) {
				args.push("--ios-language");
				args.push(config.flutterCreateIOSLanguage);
			}
			if (config.flutterCreateAndroidLanguage) {
				args.push("--android-language");
				args.push(config.flutterCreateAndroidLanguage);
			}
			args.push(projectName);
			return this.runFlutterInFolder(path.dirname(projectPath), args, projectName);
		}));
		// Internal command that's fired in user_prompts to actually do the creation.
		context.subscriptions.push(vs.commands.registerCommand("_flutter.clean", (projectPath: string, projectName?: string) => {
			projectName = projectName || path.basename(projectPath);
			const args = ["clean"];
			return this.runFlutterInFolder(path.dirname(projectPath), args, projectName);
		}));

		// Hook saving pubspec to run pub.get.
		context.subscriptions.push(vs.workspace.onDidSaveTextDocument((td) => {
			const conf = config.for(td.uri);

			if (path.basename(fsPath(td.uri)).toLowerCase() !== "pubspec.yaml")
				return;

			if (!conf.runPubGetOnPubspecChanges)
				return;

			// If we're in Fuchsia, we don't want to `pub get` by default but we do want to allow
			// it to be overridden, so only read the setting if it's been declared explicitly.
			if (sdks.projectType === ProjectType.Fuchsia && !conf.runPubGetOnPubspecChangesIsConfiguredExplicitly)
				return;

			vs.commands.executeCommand("dart.getPackages", td.uri);
		}));
	}

	private async runCommandForWorkspace(
		handler: (folder: string, args: string[], shortPath: string) => Thenable<number>,
		placeHolder: string,
		args: string[],
		selection?: vs.Uri,
	): Promise<number> {

		const folderToRunCommandIn = await this.getFolderToRunCommandIn(placeHolder, selection);
		const containingWorkspace = vs.workspace.getWorkspaceFolder(vs.Uri.file(folderToRunCommandIn));
		const containingWorkspacePath = fsPath(containingWorkspace.uri);

		// Display the relative path from the workspace root to the folder we're running, or if they're
		// the same then the folder name we're running in.
		const shortPath = path.relative(containingWorkspacePath, folderToRunCommandIn)
			|| path.basename(folderToRunCommandIn);

		return handler(folderToRunCommandIn, args, shortPath);
	}

	private async getFolderToRunCommandIn(placeHolder: string, selection?: vs.Uri): Promise<string> {
		let file = selection && fsPath(selection);
		file = file || (vs.window.activeTextEditor && fsPath(vs.window.activeTextEditor.document.uri));
		let folder = file && locateBestProjectRoot(file);

		// If there's only one folder, just use it to avoid prompting the user.
		if (!folder && vs.workspace.workspaceFolders) {
			const allowedProjects = util.getDartWorkspaceFolders();
			if (allowedProjects.length === 1)
				folder = fsPath(allowedProjects[0].uri);
		}

		return folder
			? Promise.resolve(folder)
			// TODO: Can we get this filtered?
			// https://github.com/Microsoft/vscode/issues/39132
			: vs.window.showWorkspaceFolderPick({ placeHolder }).then((f) => f && util.isDartWorkspaceFolder(f) && fsPath(f.uri)); // TODO: What if the user didn't pick anything?
	}

	private runFlutter(args: string[], selection?: vs.Uri): Thenable<number> {
		return this.runCommandForWorkspace(this.runFlutterInFolder.bind(this), `Select the folder to run "flutter ${args.join(" ")}" in`, args, selection);
	}

	private runFlutterInFolder(folder: string, args: string[], shortPath: string): Thenable<number> {
		const binPath = path.join(this.sdks.flutter, flutterPath);
		return this.runCommandInFolder(shortPath, "flutter", folder, binPath, globalFlutterArgs.concat(args));
	}

	private runPub(args: string[], selection?: vs.Uri): Thenable<number> {
		return this.runCommandForWorkspace(this.runPubInFolder.bind(this), `Select the folder to run "pub ${args.join(" ")}")}" in`, args, selection);
	}

	private runPubInFolder(folder: string, args: string[], shortPath: string): Thenable<number> {
		const binPath = path.join(this.sdks.dart, pubPath);
		args = args.concat(...config.for(vs.Uri.file(folder)).pubAdditionalArgs);
		return this.runCommandInFolder(shortPath, "pub", folder, binPath, args);
	}

	private runCommandInFolder(shortPath: string, commandName: string, folder: string, binPath: string, args: string[], isStartingBecauseOfTermination: boolean = false): Thenable<number> {

		const channelName = commandName.substr(0, 1).toUpperCase() + commandName.substr(1);
		const channel = channels.createChannel(channelName);
		channel.show(true);

		// Figure out if there's already one of this command running, in which case we'll chain off the
		// end of it.
		const commandId = `${folder}|${commandName}|${args}`;
		const existingProcess = this.runningCommands[commandId];
		if (existingProcess && !existingProcess.hasStarted) {
			// We already have a queued version of this command so there's no value in queueing another
			// just bail.
			return Promise.resolve(null);
		}

		return vs.window.withProgress({
			cancellable: true,
			location: ProgressLocation.Notification,
			title: `${commandName} ${args.join(" ")}`,
		}, (progress, token) => {
			if (existingProcess) {
				progress.report({ message: "terminating previous command..." });
				existingProcess.cancel();
			} else {
				channel.clear();
			}

			const process = new ChainedProcess(() => {
				channel.appendLine(`[${shortPath}] ${commandName} ${args.join(" ")}`);
				progress.report({ message: "running..." });
				const proc = safeSpawn(folder, binPath, args);
				channels.runProcessInChannel(proc, channel);
				return proc;
			}, existingProcess);
			this.runningCommands[commandId] = process;
			token.onCancellationRequested(() => process.cancel());

			return process.completed;
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
		const projectFolderUri = Uri.file(path.join(fsPath(folderUri), name));

		if (fs.existsSync(fsPath(projectFolderUri))) {
			vs.window.showErrorMessage(`A folder named ${name} already exists in ${fsPath(folderUri)}`);
			return;
		}

		// Create the empty folder so we can open it.
		fs.mkdirSync(fsPath(projectFolderUri));
		// Create a temp dart file to force extension to load when we open this folder.
		fs.writeFileSync(path.join(fsPath(projectFolderUri), util.FLUTTER_CREATE_PROJECT_TRIGGER_FILE), "");

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

class ChainedProcess {
	private static processNumber = 1;
	public processNumber = ChainedProcess.processNumber++;
	private completer: PromiseCompleter<number> = new PromiseCompleter<number>();
	public readonly completed = this.completer.promise;
	public process: child_process.ChildProcess;
	private isCancelled = false;
	public get hasStarted() { return this.process !== undefined; }

	constructor(private readonly spawn: () => child_process.ChildProcess, private parent: ChainedProcess) {
		// We'll either start immediately, or if given a parent process only when it completes.
		if (parent) {
			parent.completed.then(() => this.start());
		} else {
			this.start();
		}
	}

	public start(): void {
		if (this.process)
			throw new Error(`${this.processNumber} Can't start an already started process!`);
		if (this.isCancelled) {
			this.completer.resolve(null);
			return;
		}
		this.process = this.spawn();
		this.process.on("close", (code) => this.completer.resolve(code));
	}

	public cancel(): void {
		this.isCancelled = true;
	}
}
