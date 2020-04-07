import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vs from "vscode";
import { ProgressLocation, Uri, window } from "vscode";
import { FlutterCapabilities } from "../../shared/capabilities/flutter";
import { DART_STAGEHAND_PROJECT_TRIGGER_FILE, flutterPath, FLUTTER_CREATE_PROJECT_TRIGGER_FILE, pubPath } from "../../shared/constants";
import { LogCategory } from "../../shared/enums";
import { DartSdks, DartWorkspaceContext, Logger, SpawnedProcess, StagehandTemplate } from "../../shared/interfaces";
import { logProcess } from "../../shared/logging";
import { notUndefined, PromiseCompleter, uniq } from "../../shared/utils";
import { sortBy } from "../../shared/utils/array";
import { stripMarkdown } from "../../shared/utils/dartdocs";
import { findProjectFolders, fsPath, mkDirRecursive } from "../../shared/utils/fs";
import { writeDartSdkSettingIntoProject, writeFlutterSdkSettingIntoProject } from "../../shared/utils/projects";
import { FlutterDeviceManager } from "../../shared/vscode/device_manager";
import { createFlutterSampleInTempFolder } from "../../shared/vscode/flutter_samples";
import { FlutterSampleSnippet } from "../../shared/vscode/interfaces";
import { getDartWorkspaceFolders } from "../../shared/vscode/utils";
import { config } from "../config";
import { locateBestProjectRoot } from "../project";
import { DartHoverProvider } from "../providers/dart_hover_provider";
import { PubGlobal } from "../pub/global";
import { isPubGetProbablyRequired, promptToRunPubGet } from "../pub/pub";
import { Stagehand } from "../pub/stagehand";
import { getFlutterSnippets } from "../sdk/flutter_docs_snippets";
import { DartSdkManager, FlutterSdkManager } from "../sdk/sdk_manager";
import { SdkUtils } from "../sdk/utils";
import * as util from "../utils";
import { getGlobalFlutterArgs, safeToolSpawn } from "../utils/processes";
import * as channels from "./channels";

const packageNameRegex = new RegExp("^[a-z][a-z0-9_]*$");
let isFetchingPackages = false;
let runPubGetDelayTimer: NodeJS.Timer | undefined;
let lastPubspecSaveReason: vs.TextDocumentSaveReason | undefined;
let numProjectCreationsInProgress = 0;

export class SdkCommands {
	private readonly sdks: DartSdks;
	private flutterScreenshotPath?: string;
	// A map of any in-progress commands so we can terminate them if we want to run another.
	private runningCommands: { [workspaceUriAndCommand: string]: ChainedProcess | undefined; } = {};

	constructor(private readonly logger: Logger, readonly context: vs.ExtensionContext, private readonly workspace: DartWorkspaceContext, private readonly sdkUtils: SdkUtils, private readonly pubGlobal: PubGlobal, private readonly flutterCapabilities: FlutterCapabilities, private readonly deviceManager: FlutterDeviceManager) {
		this.sdks = workspace.sdks;
		const dartSdkManager = new DartSdkManager(this.logger, this.workspace.sdks);
		context.subscriptions.push(vs.commands.registerCommand("dart.changeSdk", () => dartSdkManager.changeSdk()));
		if (workspace.hasAnyFlutterProjects) {
			const flutterSdkManager = new FlutterSdkManager(this.logger, workspace.sdks);
			context.subscriptions.push(vs.commands.registerCommand("dart.changeFlutterSdk", () => flutterSdkManager.changeSdk()));
		}
		context.subscriptions.push(vs.commands.registerCommand("dart.getPackages", async (uri: string | Uri | undefined) => {
			if (!uri || !(uri instanceof Uri)) {
				uri = await this.getFolderToRunCommandIn("Select which folder to get packages for");
				// If the user cancelled, bail out (otherwise we'll prompt them again below).
				if (!uri)
					return;
			}
			if (typeof uri === "string")
				uri = vs.Uri.file(uri);
			try {
				if (util.isInsideFlutterProject(uri))
					return this.runFlutter(["pub", "get"], uri);
				else
					return this.runPub(["get"], uri);
			} finally {
				// TODO: Move this to a reusable event.
				DartHoverProvider.clearPackageMapCaches();
			}
		}));
		context.subscriptions.push(vs.commands.registerCommand("dart.listOutdatedPackages", async (uri: string | Uri | undefined) => {
			if (!uri || !(uri instanceof Uri)) {
				uri = await this.getFolderToRunCommandIn("Select which folder to check for outdated packages");
				// If the user cancelled, bail out (otherwise we'll prompt them again below).
				if (!uri)
					return;
			}
			if (typeof uri === "string")
				uri = vs.Uri.file(uri);

			if (util.isInsideFlutterProject(uri))
				return this.runFlutter(["pub", "outdated"], uri, true);
			else
				return this.runPub(["outdated"], uri, true);
		}));
		context.subscriptions.push(vs.commands.registerCommand("dart.upgradePackages", async (uri: string | Uri | undefined) => {
			// TODO: Doesn't this instanceof mean passing a string can't work?
			if (!uri || !(uri instanceof Uri))
				uri = await this.getFolderToRunCommandIn("Select which folder to upgrade packages in");
			if (typeof uri === "string")
				uri = vs.Uri.file(uri);
			if (util.isInsideFlutterProject(uri))
				return this.runFlutter(["pub", "upgrade"], uri);
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
		context.subscriptions.push(vs.commands.registerCommand("pub.outdated", (selection) => {
			return vs.commands.executeCommand("dart.listOutdatedPackages", selection);
		}));

		// Flutter commands.
		context.subscriptions.push(vs.commands.registerCommand("flutter.packages.get", async (selection): Promise<number | undefined> => {
			// TODO: This should just bounce to dart.getPackages, and ensure that handles all of the cases here.
			if (!selection) {
				const path = await this.getFolderToRunCommandIn(`Select the folder to run "flutter packages get" in`, selection);
				if (!path)
					return;
				selection = vs.Uri.file(path);
			}

			// If we're working on the flutter repository, map this on to update-packages.
			if (selection && fsPath(selection) === workspace.sdks.flutter) {
				return this.runFlutter(["update-packages"], selection);
			}

			try {
				return this.runFlutter(["pub", "get"], selection);
			} finally {
				// TODO: Move this to a reusable event.
				DartHoverProvider.clearPackageMapCaches();
			}
		}));
		context.subscriptions.push(vs.commands.registerCommand("flutter.clean", async (selection): Promise<number | undefined> => {
			if (!selection) {
				const path = await this.getFolderToRunCommandIn(`Select the folder to run "flutter clean" in`, selection, true);
				if (!path)
					return;
				selection = vs.Uri.file(path);
			}

			return this.runFlutter(["clean"], selection);
		}));
		context.subscriptions.push(vs.commands.registerCommand("_flutter.screenshot.touchBar", (args: any) => vs.commands.executeCommand("flutter.screenshot", args)));
		context.subscriptions.push(vs.commands.registerCommand("flutter.screenshot", async () => {
			let shouldNotify = false;

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
			mkDirRecursive(this.flutterScreenshotPath);

			const deviceId = this.deviceManager && this.deviceManager.currentDevice ? this.deviceManager.currentDevice.id : undefined;
			const args = deviceId ? ["screenshot", "-d", deviceId] : ["screenshot"];
			await this.runFlutterInFolder(this.flutterScreenshotPath, args, "screenshot", true);

			if (shouldNotify) {
				const res = await vs.window.showInformationMessage(`Screenshots will be saved to ${this.flutterScreenshotPath}`, "Show Folder");
				if (res)
					await vs.commands.executeCommand("revealFileInOS", Uri.file(this.flutterScreenshotPath));
			}
		}));
		context.subscriptions.push(vs.commands.registerCommand("flutter.packages.upgrade", (selection) => {
			return vs.commands.executeCommand("dart.upgradePackages", selection);
		}));
		context.subscriptions.push(vs.commands.registerCommand("flutter.packages.outdated", (selection) => {
			return vs.commands.executeCommand("dart.listOutdatedPackages", selection);
		}));
		context.subscriptions.push(vs.commands.registerCommand("flutter.doctor", (selection) => {
			if (!workspace.sdks.flutter) {
				this.sdkUtils.showFlutterActivationFailure("flutter.doctor");
				return;
			}
			const tempDir = path.join(os.tmpdir(), "dart-code-cmd-run");
			if (!fs.existsSync(tempDir))
				fs.mkdirSync(tempDir);
			return this.runFlutterInFolder(tempDir, ["doctor", "-v"], "flutter", true, { customScript: workspace.bazelWorkspaceConfig?.flutterDoctorScript });
		}));
		context.subscriptions.push(vs.commands.registerCommand("flutter.upgrade", async (selection) => {
			if (!workspace.sdks.flutter) {
				this.sdkUtils.showFlutterActivationFailure("flutter.upgrade");
				return;
			}
			const tempDir = path.join(os.tmpdir(), "dart-code-cmd-run");
			if (!fs.existsSync(tempDir))
				fs.mkdirSync(tempDir);
			await this.runFlutterInFolder(tempDir, ["upgrade"], "flutter", true);
			await util.promptToReloadExtension();
		}));
		context.subscriptions.push(vs.commands.registerCommand("flutter.createProject", (_) => this.createFlutterProject()));
		context.subscriptions.push(vs.commands.registerCommand("_dart.flutter.createSampleProject", (_) => this.createFlutterSampleProject()));
		context.subscriptions.push(vs.commands.registerCommand("dart.createProject", (_) => this.createDartProject()));
		context.subscriptions.push(vs.commands.registerCommand("_dart.create", (projectPath: string, templateName: string) => {
			const args = ["global", "run", "stagehand", templateName];
			return this.runPubInFolder(projectPath, args, templateName);
		}));
		context.subscriptions.push(vs.commands.registerCommand("_flutter.create", (projectPath: string, projectName?: string, sampleID?: string) => {
			const args = ["create"];
			if (config.flutterCreateOffline) {
				args.push("--offline");
			}
			if (projectName) {
				args.push("--project-name");
				args.push(projectName);
			}
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
			if (config.flutterAndroidX) {
				args.push("--androidx");
			}
			if (sampleID) {
				args.push("--sample");
				args.push(sampleID);
				args.push("--overwrite");
			}
			args.push(".");
			return this.runFlutterInFolder(projectPath, args, projectName);
		}));
		context.subscriptions.push(vs.commands.registerCommand("_flutter.clean", (projectPath: string, projectName?: string) => {
			projectName = projectName || path.basename(projectPath);
			const args = ["clean"];
			return this.runFlutterInFolder(projectPath, args, projectName);
		}));

		// Hook saving pubspec to run pub.get.
		this.setupPubspecWatcher(context);
	}

	private setupPubspecWatcher(context: vs.ExtensionContext) {
		context.subscriptions.push(vs.workspace.onWillSaveTextDocument((e) => {
			if (path.basename(fsPath(e.document.uri)).toLowerCase() === "pubspec.yaml")
				lastPubspecSaveReason = e.reason;
		}));
		const watcher = vs.workspace.createFileSystemWatcher("**/pubspec.yaml");
		context.subscriptions.push(watcher);
		watcher.onDidChange(this.handlePubspecChange, this);
		watcher.onDidCreate(this.handlePubspecChange, this);
	}

	private handlePubspecChange(uri: vs.Uri) {
		this.logger.info(`Pubspec ${fsPath(uri)} was modified`);
		const conf = config.for(uri);

		// Don't do anything if we're disabled.
		if (!conf.runPubGetOnPubspecChanges) {
			this.logger.info(`Automatically running "pub get" is disabled`);
			return;
		}

		// Never do anything for files inside .dart_tool folders.
		if (fsPath(uri).indexOf(`${path.sep}.dart_tool${path.sep}`) !== -1) {
			this.logger.info(`Change was inside a .dart_tool folder, skipping`);
			return;
		}

		// Don't do anything if we're in the middle of creating projects, as packages
		// may  be fetched automatically.
		if (numProjectCreationsInProgress > 0) {
			this.logger.info("Skipping package fetch because project creation is in progress");
			return;
		}

		// If we're in Fuchsia, we don't want to `pub get` by default but we do want to allow
		// it to be overridden, so only read the setting if it's been declared explicitly.
		// TODO: This should be handled per-project for a multi-root workspace.
		if (this.workspace.shouldAvoidFetchingPackages && !conf.runPubGetOnPubspecChangesIsConfiguredExplicitly) {
			this.logger.info(`Workspace suppresses "pub get"`);
			return;
		}

		// Cancel any existing delayed timer.
		if (runPubGetDelayTimer) {
			clearTimeout(runPubGetDelayTimer);
		}

		// If the save was triggered by one of the auto-save options, then debounce longer.
		const debounceDuration = lastPubspecSaveReason === vs.TextDocumentSaveReason.FocusOut
			|| lastPubspecSaveReason === vs.TextDocumentSaveReason.AfterDelay
			? 10000
			: 1000;

		runPubGetDelayTimer = setTimeout(() => {
			runPubGetDelayTimer = undefined;
			lastPubspecSaveReason = undefined;
			this.fetchPackagesOrPrompt(uri);
		}, debounceDuration); // TODO: Does this need to be configurable?
	}

	public async fetchPackagesOrPrompt(uri: vs.Uri | undefined, options?: { alwaysPrompt?: boolean }): Promise<void> {
		if (isFetchingPackages) {
			this.logger.info(`Already running pub get, skipping!`);
			return;
		}
		isFetchingPackages = true;
		// TODO: Extract this into a Pub class with the things in pub.ts.

		try {
			const forcePrompt = options && options.alwaysPrompt;
			// We debounced so we might get here and have multiple projects to fetch for
			// for ex. when we change Git branch we might change many files at once. So
			// check how many there are, and if there are:
			//   0 - then just use Uri
			//   1 - then just do that one
			//   more than 1 - prompt to do all
			const topLevelFolders = getDartWorkspaceFolders().map((wf) => fsPath(wf.uri));
			const folders = await findProjectFolders(topLevelFolders, { requirePubspec: true });
			const foldersRequiringPackageGet = uniq(folders)
				.map(vs.Uri.file)
				.filter((uri) => config.for(uri).promptToGetPackages)
				.filter(isPubGetProbablyRequired);
			this.logger.info(`Found ${foldersRequiringPackageGet.length} folders requiring "pub get":${foldersRequiringPackageGet.map((uri) => `\n    ${fsPath(uri)}`).join("")}`);
			if (!forcePrompt && foldersRequiringPackageGet.length === 0)
				await vs.commands.executeCommand("dart.getPackages", uri);
			else if (!forcePrompt && foldersRequiringPackageGet.length === 1)
				await vs.commands.executeCommand("dart.getPackages", foldersRequiringPackageGet[0]);
			else if (foldersRequiringPackageGet.length)
				promptToRunPubGet(foldersRequiringPackageGet);
		} finally {
			isFetchingPackages = false;
		}
	}

	private async runCommandForWorkspace(
		handler: (folder: string, args: string[], shortPath: string, alwaysShowOutput: boolean) => Thenable<number | undefined>,
		placeHolder: string,
		args: string[],
		selection: vs.Uri | undefined,
		alwaysShowOutput = false,
	): Promise<number | undefined> {
		const folderToRunCommandIn = await this.getFolderToRunCommandIn(placeHolder, selection);
		if (!folderToRunCommandIn)
			return;

		const containingWorkspace = vs.workspace.getWorkspaceFolder(vs.Uri.file(folderToRunCommandIn));
		if (!containingWorkspace) {
			this.logger.error(`Failed to get workspace folder for ${folderToRunCommandIn}`);
			throw new Error(`Failed to get workspace folder for ${folderToRunCommandIn}`);
		}
		const containingWorkspacePath = fsPath(containingWorkspace.uri);

		// Display the relative path from the workspace root to the folder we're running, or if they're
		// the same then the folder name we're running in.
		const shortPath = path.relative(containingWorkspacePath, folderToRunCommandIn)
			|| path.basename(folderToRunCommandIn);

		return handler(folderToRunCommandIn, args, shortPath, alwaysShowOutput);
	}

	private async getFolderToRunCommandIn(placeHolder: string, selection?: vs.Uri, flutterOnly = false): Promise<string | undefined> {
		// Attempt to find a project based on the supplied folder of active file.
		let file = selection && fsPath(selection);
		file = file || (vs.window.activeTextEditor && fsPath(vs.window.activeTextEditor.document.uri));
		const folder = file && locateBestProjectRoot(file);

		if (folder)
			return folder;

		// Otherwise look for what projects we have.
		const topLevelFolders = getDartWorkspaceFolders().map((wf) => fsPath(wf.uri));
		const selectableFolders = (await findProjectFolders(topLevelFolders, { sort: true }))
			.filter(flutterOnly ? util.isFlutterProjectFolder : () => true);

		if (!selectableFolders || !selectableFolders.length) {
			const projectTypes = flutterOnly ? "Flutter" : "Dart/Flutter";
			vs.window.showWarningMessage(`No ${projectTypes} projects were found.`);
			return undefined;
		}

		return this.showFolderPicker(selectableFolders, placeHolder); // TODO: What if the user didn't pick anything?
	}

	private async showFolderPicker(folders: string[], placeHolder: string): Promise<string | undefined> {
		// No point asking the user if there's only one.
		if (folders.length === 1) {
			return folders[0];
		}

		const items = folders.map((f) => {
			const workspaceFolder = vs.workspace.getWorkspaceFolder(Uri.file(f));
			if (!workspaceFolder)
				return undefined;

			const workspacePathParent = path.dirname(fsPath(workspaceFolder.uri));
			return {
				description: util.homeRelativePath(workspacePathParent),
				label: path.relative(workspacePathParent, f),
				path: f,
			} as vs.QuickPickItem & { path: string };
		}).filter(notUndefined);

		const selectedFolder = await vs.window.showQuickPick(items, { placeHolder });
		return selectedFolder && selectedFolder.path;
	}

	private runFlutter(args: string[], selection: vs.Uri | undefined, alwaysShowOutput = false): Thenable<number | undefined> {
		return this.runCommandForWorkspace(this.runFlutterInFolder.bind(this), `Select the folder to run "flutter ${args.join(" ")}" in`, args, selection, alwaysShowOutput);
	}

	private withCustomScript(binPath: string, binArgs: string[], options?: { customScript?: string, customScriptReplacesNumArgs?: number }) {
		if (options?.customScript) {
			binPath = options.customScript;
			const numArgsToRemove = options.customScriptReplacesNumArgs !== undefined
				? options.customScriptReplacesNumArgs
				: 1; // Default to removing one arg.
			binArgs = binArgs.slice(numArgsToRemove);
		}

		return { binPath, binArgs };
	}

	private runFlutterInFolder(folder: string, args: string[], shortPath: string | undefined, alwaysShowOutput = false, options?: { customScript?: string, customScriptReplacesNumArgs?: number }): Thenable<number | undefined> {
		if (!this.sdks.flutter)
			throw new Error("Flutter SDK not available");

		const { binPath, binArgs } = this.withCustomScript(
			path.join(this.sdks.flutter, flutterPath),
			args,
			options,
		);

		const allArgs = getGlobalFlutterArgs()
			.concat(config.for(vs.Uri.file(folder)).flutterAdditionalArgs)
			.concat(binArgs);

		return this.runCommandInFolder(shortPath, folder, binPath, allArgs, alwaysShowOutput);
	}

	private runPub(args: string[], selection: vs.Uri | undefined, alwaysShowOutput = false): Thenable<number | undefined> {
		return this.runCommandForWorkspace(this.runPubInFolder.bind(this), `Select the folder to run "pub ${args.join(" ")}" in`, args, selection, alwaysShowOutput);
	}

	private runPubInFolder(folder: string, args: string[], shortPath: string, alwaysShowOutput = false): Thenable<number | undefined> {
		if (!this.sdks.dart)
			throw new Error("Flutter SDK not available");

		const binPath = path.join(this.sdks.dart, pubPath);
		args = args.concat(...config.for(vs.Uri.file(folder)).pubAdditionalArgs);
		return this.runCommandInFolder(shortPath, folder, binPath, args, alwaysShowOutput);
	}

	private runCommandInFolder(shortPath: string | undefined, folder: string, binPath: string, args: string[], alwaysShowOutput: boolean): Thenable<number | undefined> {
		shortPath = shortPath || path.basename(folder);
		const commandName = path.basename(binPath);

		const channel = channels.createChannel(`${commandName} (${shortPath})`);
		if (alwaysShowOutput)
			channel.show();

		// Figure out if there's already one of this command running, in which case we'll chain off the
		// end of it.
		const commandId = `${folder}|${commandName}|${args}`;
		const existingProcess = this.runningCommands[commandId];
		if (existingProcess && !existingProcess.hasStarted) {
			// We already have a queued version of this command so there's no value in queueing another
			// just bail.
			return Promise.resolve(undefined);
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
				const proc = safeToolSpawn(folder, binPath, args);
				channels.runProcessInChannel(proc, channel);
				this.logger.info(`(PROC ${proc.pid}) Spawned ${binPath} ${args.join(" ")} in ${folder}`, LogCategory.CommandProcesses);
				logProcess(this.logger, LogCategory.CommandProcesses, proc);
				proc.on("close", (code) => {
					if (code)
						channel.show(true);
				});
				return proc;
			}, existingProcess);
			this.runningCommands[commandId] = process;
			token.onCancellationRequested(() => process.cancel());

			return process.completed;
		});
	}

	private async createDartProject(): Promise<void> {
		return this.createStagehandProject("dart.createProject", DART_STAGEHAND_PROJECT_TRIGGER_FILE, false);
	}

	private async createStagehandProject(command: string, triggerFilename: string, autoPickIfSingleItem: boolean, filter?: (t: StagehandTemplate) => boolean): Promise<void> {
		if (!this.sdks || !this.sdks.dart) {
			this.sdkUtils.showDartActivationFailure(command);
			return;
		}

		// Get the JSON for the available templates by calling stagehand.

		const stagehand = new Stagehand(this.logger, this.sdks, this.pubGlobal);
		const isAvailable = await stagehand.promptToInstallIfRequired();
		if (!isAvailable) {
			return;
		}
		let templates: StagehandTemplate[];
		try {
			templates = await stagehand.getTemplates();
		} catch (e) {
			vs.window.showErrorMessage(`Unable to execute Stagehand. ${e}`);
			return;
		}

		const filteredTemplate = filter ? templates.filter(filter) : templates;
		const sortedTemplates = sortBy(filteredTemplate, (s) => s.label);
		const pickItems = sortedTemplates.map((t) => ({
			description: t.name,
			detail: t.description,
			label: t.label,
			template: t,
		}));

		// Get the user to pick a template (but pick for them if there's only one
		// and autoPickIfSingleItem).
		const selectedTemplate =
			autoPickIfSingleItem && pickItems.length === 1
				? pickItems[0]
				: await vs.window.showQuickPick(
					pickItems,
					{
						matchOnDescription: true,
						placeHolder: "Which Dart template?",
					},
				);

		if (!selectedTemplate)
			return;

		const name = await vs.window.showInputBox({ prompt: "Enter a name for your new project", placeHolder: "hello_world", validateInput: this.validateDartProjectName });
		if (!name)
			return;

		// If already in a workspace, set the default folder to something nearby.
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
		fs.writeFileSync(path.join(fsPath(projectFolderUri), triggerFilename), JSON.stringify(selectedTemplate.template));
		// If we're using a custom SDK, we need to apply it to the new project too.
		if (config.workspaceSdkPath)
			writeDartSdkSettingIntoProject(config.workspaceSdkPath, fsPath(projectFolderUri));

		const hasFoldersOpen = !!(vs.workspace.workspaceFolders && vs.workspace.workspaceFolders.length);
		const openInNewWindow = hasFoldersOpen;
		vs.commands.executeCommand("vscode.openFolder", projectFolderUri, openInNewWindow);
	}

	private async createFlutterProject(): Promise<void> {
		if (!this.sdks || !this.sdks.flutter) {
			this.sdkUtils.showFlutterActivationFailure("flutter.createProject");
			return;
		}

		const name = await vs.window.showInputBox({ prompt: "Enter a name for your new project", placeHolder: "hello_world", validateInput: this.validateFlutterProjectName });
		if (!name)
			return;

		// If already in a workspace, set the default folder to something nearby.
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
		fs.writeFileSync(path.join(fsPath(projectFolderUri), FLUTTER_CREATE_PROJECT_TRIGGER_FILE), "");
		// If we're using a custom SDK, we need to apply it to the new project too.
		if (config.workspaceFlutterSdkPath)
			writeFlutterSdkSettingIntoProject(config.workspaceFlutterSdkPath, fsPath(projectFolderUri));

		const hasFoldersOpen = !!(vs.workspace.workspaceFolders && vs.workspace.workspaceFolders.length);
		const openInNewWindow = hasFoldersOpen;
		vs.commands.executeCommand("vscode.openFolder", projectFolderUri, openInNewWindow);
	}

	private async createFlutterSampleProject(): Promise<vs.Uri | undefined> {
		if (!this.sdks || !this.sdks.flutter) {
			this.sdkUtils.showFlutterActivationFailure("_dart.flutter.createSampleProject");
			return;
		}

		// Fetch the JSON for the available samples.
		let snippets: FlutterSampleSnippet[];
		try {
			snippets = await getFlutterSnippets(this.logger, this.sdks, this.flutterCapabilities);
		} catch {
			vs.window.showErrorMessage("Unable to retrieve Flutter documentation snippets");
			return;
		}

		const sortedSnippets = sortBy(snippets, (s) => s.element);

		const selectedSnippet = await vs.window.showQuickPick(
			sortedSnippets.map((s) => ({
				description: `${s.package}/${s.library}`,
				detail: stripMarkdown(s.description),
				label: s.element,
				snippet: s,
			})),
			{
				matchOnDescription: true,
				placeHolder: "Which Flutter sample?",
			},
		);
		if (!selectedSnippet)
			return;

		return createFlutterSampleInTempFolder(this.flutterCapabilities, selectedSnippet.snippet.id, config.workspaceFlutterSdkPath);
	}

	private validateDartProjectName(input: string) {
		if (!packageNameRegex.test(input))
			return "Dart project names should be all lowercase, with underscores to separate words";
		const bannedNames = ["dart", "test"];
		if (bannedNames.indexOf(input) !== -1)
			return `You may not use ${input} as the name for a dart project`;
	}

	private validateFlutterProjectName(input: string) {
		if (!packageNameRegex.test(input))
			return "Flutter project names should be all lowercase, with underscores to separate words";
		const bannedNames = ["flutter", "flutter_test", "test"];
		if (bannedNames.indexOf(input) !== -1)
			return `You may not use ${input} as the name for a flutter project`;
	}
}

export function markProjectCreationStarted(): void {
	numProjectCreationsInProgress++;
}
export function markProjectCreationEnded(): void {
	numProjectCreationsInProgress--;
}

class ChainedProcess {
	private static processNumber = 1;
	public processNumber = ChainedProcess.processNumber++;
	private completer: PromiseCompleter<number | undefined> = new PromiseCompleter<number | undefined>();
	public readonly completed = this.completer.promise;
	public process: SpawnedProcess | undefined;
	private isCancelled = false;
	public get hasStarted() { return this.process !== undefined; }

	constructor(private readonly spawn: () => SpawnedProcess, parent: ChainedProcess | undefined) {
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
			this.completer.resolve(undefined);
			return;
		}
		this.process = this.spawn();
		this.process.on("close", (code) => this.completer.resolve(code));
	}

	public cancel(): void {
		this.isCancelled = true;
	}
}
