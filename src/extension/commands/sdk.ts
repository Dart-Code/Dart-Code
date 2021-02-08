import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vs from "vscode";
import { ProgressLocation, Uri, window } from "vscode";
import { DartCapabilities } from "../../shared/capabilities/dart";
import { FlutterCapabilities } from "../../shared/capabilities/flutter";
import { dartVMPath, DART_STAGEHAND_PROJECT_TRIGGER_FILE, flutterPath, pubPath } from "../../shared/constants";
import { LogCategory } from "../../shared/enums";
import { CustomScript, DartSdks, DartWorkspaceContext, FlutterCreateTriggerData, Logger, SpawnedProcess, StagehandTemplate } from "../../shared/interfaces";
import { logProcess } from "../../shared/logging";
import { flatMap, PromiseCompleter, uniq, usingCustomScript } from "../../shared/utils";
import { sortBy } from "../../shared/utils/array";
import { stripMarkdown } from "../../shared/utils/dartdocs";
import { findProjectFolders, fsPath, mkDirRecursive } from "../../shared/utils/fs";
import { writeDartSdkSettingIntoProject, writeFlutterSdkSettingIntoProject, writeFlutterTriggerFile } from "../../shared/utils/projects";
import { FlutterDeviceManager } from "../../shared/vscode/device_manager";
import { createFlutterSampleInTempFolder } from "../../shared/vscode/flutter_samples";
import { FlutterSampleSnippet } from "../../shared/vscode/interfaces";
import { getDartWorkspaceFolders } from "../../shared/vscode/utils";
import { config } from "../config";
import { PubGlobal } from "../pub/global";
import { isPubGetProbablyRequired, promptToRunPubGet } from "../pub/pub";
import { Stagehand } from "../pub/stagehand";
import { getFlutterSnippets } from "../sdk/flutter_docs_snippets";
import { DartSdkManager, FlutterSdkManager } from "../sdk/sdk_manager";
import { SdkUtils } from "../sdk/utils";
import * as util from "../utils";
import { getGlobalFlutterArgs, safeToolSpawn } from "../utils/processes";
import { getFolderToRunCommandIn } from "../utils/vscode/projects";
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
	private runningCommands: { [workspaceUriAndCommand: string]: ChainedProcess | undefined } = {};

	constructor(private readonly logger: Logger, private readonly context: vs.ExtensionContext, private readonly workspace: DartWorkspaceContext, private readonly sdkUtils: SdkUtils, private readonly pubGlobal: PubGlobal, private readonly dartCapabilities: DartCapabilities, private readonly flutterCapabilities: FlutterCapabilities, private readonly deviceManager: FlutterDeviceManager) {
		this.sdks = workspace.sdks;
		const dartSdkManager = new DartSdkManager(this.logger, this.workspace.sdks);
		context.subscriptions.push(vs.commands.registerCommand("dart.changeSdk", () => dartSdkManager.changeSdk()));
		if (workspace.hasAnyFlutterProjects) {
			const flutterSdkManager = new FlutterSdkManager(this.logger, workspace.sdks);
			context.subscriptions.push(vs.commands.registerCommand("dart.changeFlutterSdk", () => flutterSdkManager.changeSdk()));
		}
		context.subscriptions.push(vs.commands.registerCommand("dart.getPackages", this.getPackages, this));
		context.subscriptions.push(vs.commands.registerCommand("dart.listOutdatedPackages", this.listOutdatedPackages, this));
		context.subscriptions.push(vs.commands.registerCommand("dart.upgradePackages", this.upgradePackages, this));

		// Pub commands.
		context.subscriptions.push(vs.commands.registerCommand("pub.get", (selection) => vs.commands.executeCommand("dart.getPackages", selection)));
		context.subscriptions.push(vs.commands.registerCommand("pub.upgrade", (selection) => vs.commands.executeCommand("dart.upgradePackages", selection)));
		context.subscriptions.push(vs.commands.registerCommand("pub.outdated", (selection) => vs.commands.executeCommand("dart.listOutdatedPackages", selection)));

		// Flutter commands.
		context.subscriptions.push(vs.commands.registerCommand("flutter.packages.get", this.flutterGetPackages, this));
		context.subscriptions.push(vs.commands.registerCommand("flutter.clean", this.flutterClean, this));
		context.subscriptions.push(vs.commands.registerCommand("_flutter.screenshot.touchBar", (args: any) => vs.commands.executeCommand("flutter.screenshot", args)));
		context.subscriptions.push(vs.commands.registerCommand("flutter.screenshot", this.flutterScreenshot, this));
		context.subscriptions.push(vs.commands.registerCommand("flutter.packages.upgrade", (selection) => vs.commands.executeCommand("dart.upgradePackages", selection)));
		context.subscriptions.push(vs.commands.registerCommand("flutter.packages.outdated", (selection) => vs.commands.executeCommand("dart.listOutdatedPackages", selection)));
		context.subscriptions.push(vs.commands.registerCommand("flutter.doctor", this.flutterDoctor, this));
		context.subscriptions.push(vs.commands.registerCommand("flutter.upgrade", this.flutterUpgrade, this));
		context.subscriptions.push(vs.commands.registerCommand("flutter.createProject", this.createFlutterProject, this));
		context.subscriptions.push(vs.commands.registerCommand("flutter.createProject.module", () => this.createFlutterProject("module"), this));
		context.subscriptions.push(vs.commands.registerCommand("flutter.createProject.package", () => this.createFlutterProject("package"), this));
		context.subscriptions.push(vs.commands.registerCommand("flutter.createProject.plugin", () => this.createFlutterProject("plugin"), this));
		context.subscriptions.push(vs.commands.registerCommand("_dart.flutter.createSampleProject", this.createFlutterSampleProject, this));
		context.subscriptions.push(vs.commands.registerCommand("dart.createProject", this.createDartProject, this));
		context.subscriptions.push(vs.commands.registerCommand("_dart.create", this.dartCreate, this));
		context.subscriptions.push(vs.commands.registerCommand("_flutter.create", this.flutterCreate, this));
		context.subscriptions.push(vs.commands.registerCommand("_flutter.clean", this.flutterClean, this));

		// Hook saving pubspec to run pub.get.
		this.setupPubspecWatcher(context);

		// Monitor version files for SDK upgrades.
		this.setupVersionWatcher(context);
	}

	private async getPackages(uri: string | Uri | undefined) {
		if (!uri || !(uri instanceof Uri)) {
			uri = await getFolderToRunCommandIn(this.logger, "Select which folder to get packages for");
			// If the user cancelled, bail out (otherwise we'll prompt them again below).
			if (!uri)
				return;
		}
		if (typeof uri === "string")
			uri = vs.Uri.file(uri);


		if (util.isInsideFlutterProject(uri))
			return this.runFlutter(["pub", "get"], uri);
		else
			return this.runPub(["get"], uri);
	}

	private async listOutdatedPackages(uri: string | Uri | undefined) {
		if (!uri || !(uri instanceof Uri)) {
			uri = await getFolderToRunCommandIn(this.logger, "Select which folder to check for outdated packages");
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
	}

	private async upgradePackages(uri: string | Uri | undefined) {
		if (!uri || !(uri instanceof Uri)) {
			uri = await getFolderToRunCommandIn(this.logger, "Select which folder to upgrade packages in");
			// If the user cancelled, bail out (otherwise we'll prompt them again below).
			if (!uri)
				return;
		}
		if (typeof uri === "string")
			uri = vs.Uri.file(uri);
		if (util.isInsideFlutterProject(uri))
			return this.runFlutter(["pub", "upgrade"], uri);
		else
			return this.runPub(["upgrade"], uri);
	}

	private async flutterGetPackages(selection: vs.Uri | undefined): Promise<number | undefined> {
		// TODO: This should just bounce to dart.getPackages, and ensure that handles all of the cases here.
		if (!selection) {
			const path = await getFolderToRunCommandIn(this.logger, `Select the folder to run "flutter packages get" in`, selection);
			if (!path)
				return;
			selection = vs.Uri.file(path);
		}

		// If we're working on the flutter repository, map this on to update-packages.
		if (selection && fsPath(selection) === this.workspace.sdks.flutter) {
			return this.runFlutter(["update-packages"], selection);
		}

		return this.runFlutter(["pub", "get"], selection);
	}

	private async flutterClean(selection: vs.Uri | undefined): Promise<number | undefined> {
		if (!selection) {
			const path = await getFolderToRunCommandIn(this.logger, `Select the folder to run "flutter clean" in`, selection, true);
			if (!path)
				return;
			selection = vs.Uri.file(path);
		}

		return this.runFlutter(["clean"], selection);
	}

	private async flutterScreenshot() {
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
	}

	private dartCreate(projectPath: string, templateName: string) {
		const args = ["global", "run", "stagehand", templateName];
		return this.runPubInFolder(projectPath, args, templateName);
	}

	public flutterDoctor() {
		if (!this.workspace.sdks.flutter) {
			this.sdkUtils.showFlutterActivationFailure("flutter.doctor");
			return;
		}
		const tempDir = path.join(os.tmpdir(), "dart-code-cmd-run");
		if (!fs.existsSync(tempDir))
			fs.mkdirSync(tempDir);
		return this.runFlutterInFolder(tempDir, ["doctor", "-v"], "flutter", true, this.workspace.config?.flutterDoctorScript || this.workspace.config?.flutterScript);
	}

	private async flutterUpgrade() {
		if (!this.workspace.sdks.flutter) {
			this.sdkUtils.showFlutterActivationFailure("flutter.upgrade");
			return;
		}
		const tempDir = path.join(os.tmpdir(), "dart-code-cmd-run");
		if (!fs.existsSync(tempDir))
			fs.mkdirSync(tempDir);
		// Don't prompt to reload when the version changes, as we automatically reload here.
		this.promptToReloadOnVersionChanges = false;
		await this.runFlutterInFolder(tempDir, ["upgrade"], "flutter", true);
		await util.promptToReloadExtension();
	}

	private async flutterCreate(projectPath: string | undefined, projectName?: string, triggerData?: FlutterCreateTriggerData) {
		if (!projectPath) {
			projectPath = await getFolderToRunCommandIn(this.logger, `Select the folder to run "flutter create" in`, undefined, true);
			if (!projectPath)
				return;
		}

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
		if (triggerData?.sample) {
			args.push("--sample");
			args.push(triggerData.sample);
			args.push("--overwrite");
		}
		if (triggerData?.template) {
			args.push("--template");
			args.push(triggerData.template);
			args.push("--overwrite");
		}
		args.push(".");
		return this.runFlutterInFolder(projectPath, args, projectName);
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

	private promptToReloadOnVersionChanges = true;
	private async setupVersionWatcher(context: vs.ExtensionContext) {
		// On Windows, the watcher sometimes fires even if the file wasn't modified (could be when
		// accessed), so we need to filter those out. We can't just check the modified time is "recent"
		// because the unzip preserves the modification dates of the SDK. Instead, we'll capture the mtime
		// of the file at start, and then fire only if that time actually changes.
		const versionFile = path.join(this.sdks.dart, "version");
		const getModifiedTimeMs = async () => {
			try {
				return (await fs.promises.stat(versionFile)).mtime.getTime();
			} catch (error) {
				this.logger.warn(`Failed to check modification time on version file. ${error}`);
				return;
			}
		};
		let lastModifiedTime = await getModifiedTimeMs();
		// If we couldn't get the initial modified time, we can't track this.
		if (!lastModifiedTime)
			return;

		const watcher = fs.watch(versionFile, { persistent: false }, async (eventType: string) => {
			if (!this.promptToReloadOnVersionChanges)
				return;

			const newModifiedTime = await getModifiedTimeMs();

			// Bail if we couldn't get a new modified time, or it was the same as the last one.
			if (!newModifiedTime || newModifiedTime === lastModifiedTime)
				return;

			lastModifiedTime = newModifiedTime;

			// Ensure we don't fire too often as some OSes may generate multiple events.
			this.promptToReloadOnVersionChanges = false;
			// Allow it again in 60 seconds.
			setTimeout(() => this.promptToReloadOnVersionChanges = true, 60000);

			// Wait a short period before prompting.
			setTimeout(() => util.promptToReloadExtension("Your Dart SDK has been updated. Reload using the new SDK?", undefined, false), 1000);
		});

		context.subscriptions.push({ dispose() { watcher.close(); } });
	}

	private handlePubspecChange(uri: vs.Uri) {
		const filePath = fsPath(uri);

		// Never do anything for files inside hidden or build folders.
		if (filePath.includes(`${path.sep}.`) || filePath.includes(`${path.sep}build${path.sep}`)) {
			this.logger.info(`Skipping pubspec change for ignored folder ${filePath}`);
			return;
		}

		this.logger.info(`Pubspec ${filePath} was modified`);
		const conf = config.for(uri);

		// Don't do anything if we're disabled.
		if (!conf.runPubGetOnPubspecChanges) {
			this.logger.info(`Automatically running "pub get" is disabled`);
			return;
		}

		// Or if the workspace config says we shouldn't run.
		if (this.workspace.config.disableAutomaticPackageGet) {
			this.logger.info(`Workspace suppresses automatic "pub get"`);
			return;
		}

		// Don't do anything if we're in the middle of creating projects, as packages
		// may  be fetched automatically.
		if (numProjectCreationsInProgress > 0) {
			this.logger.info("Skipping package fetch because project creation is in progress");
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
			// tslint:disable-next-line: no-floating-promises
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
			const workspaceFolders = getDartWorkspaceFolders();
			const topLevelFolders = workspaceFolders.map((w) => fsPath(w.uri));
			const allExcludedFolders = flatMap(workspaceFolders, util.getExcludedFolders);
			const folders = await findProjectFolders(this.logger, topLevelFolders, allExcludedFolders, { requirePubspec: true });
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
		const folderToRunCommandIn = await getFolderToRunCommandIn(this.logger, placeHolder, selection);
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

	private runFlutter(args: string[], selection: vs.Uri | undefined, alwaysShowOutput = false): Thenable<number | undefined> {
		return this.runCommandForWorkspace(this.runFlutterInFolder.bind(this), `Select the folder to run "flutter ${args.join(" ")}" in`, args, selection, alwaysShowOutput);
	}

	private runFlutterInFolder(folder: string, args: string[], shortPath: string | undefined, alwaysShowOutput = false, customScript?: CustomScript): Thenable<number | undefined> {
		if (!this.sdks.flutter)
			throw new Error("Flutter SDK not available");

		const { binPath, binArgs } = usingCustomScript(
			path.join(this.sdks.flutter, flutterPath),
			args,
			customScript,
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
			throw new Error("Dart SDK not available");

		let binPath: string;

		if (this.dartCapabilities.supportsDartPub) {
			binPath = path.join(this.sdks.dart, dartVMPath);
			args = ["pub"].concat(args);
		} else {
			binPath = path.join(this.sdks.dart, pubPath);
		}
		args = args.concat(...config.for(vs.Uri.file(folder)).pubAdditionalArgs);
		return this.runCommandInFolder(shortPath, folder, binPath, args, alwaysShowOutput);
	}

	private runCommandInFolder(shortPath: string | undefined, folder: string, binPath: string, args: string[], alwaysShowOutput: boolean): Thenable<number | undefined> {
		shortPath = shortPath || path.basename(folder);
		const commandName = path.basename(binPath).split(".")[0]; // Trim file extension.

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

				// If we complete with a non-zero code, or don't complete within 10s, we should show
				// the output pane.
				const completedWithErrorPromise = new Promise((resolve) => proc.on("close", resolve));
				const timedOutPromise = new Promise((resolve) => setTimeout(() => resolve(true), 10000));
				// tslint:disable-next-line: no-floating-promises
				Promise.race([completedWithErrorPromise, timedOutPromise]).then((showOutput) => {
					if (showOutput)
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

		// If already in a workspace, set the default folder to something nearby.
		const folders = await vs.window.showOpenDialog({ canSelectFolders: true, openLabel: "Select a folder to create the project in" });
		if (!folders || folders.length !== 1)
			return;
		const folderPath = fsPath(folders[0]);

		const defaultName = await this.nextAvailableName(folderPath, "dart_application_");
		const name = await vs.window.showInputBox({ prompt: "Enter a name for your new project", placeHolder: defaultName, value: defaultName, validateInput: (s) => this.validateDartProjectName(s, folderPath) });
		if (!name)
			return;

		const projectFolderUri = Uri.file(path.join(folderPath, name));
		const projectFolderPath = fsPath(projectFolderUri);

		if (fs.existsSync(projectFolderPath)) {
			vs.window.showErrorMessage(`A folder named ${name} already exists in ${folderPath}`);
			return;
		}

		// Create the empty folder so we can open it.
		fs.mkdirSync(projectFolderPath);
		// Create a temp dart file to force extension to load when we open this folder.
		fs.writeFileSync(path.join(projectFolderPath, triggerFilename), JSON.stringify(selectedTemplate.template));
		// If we're using a custom SDK, we need to apply it to the new project too.
		if (config.workspaceSdkPath)
			writeDartSdkSettingIntoProject(config.workspaceSdkPath, projectFolderPath);

		const hasFoldersOpen = !!(vs.workspace.workspaceFolders && vs.workspace.workspaceFolders.length);
		const openInNewWindow = hasFoldersOpen;
		vs.commands.executeCommand("vscode.openFolder", projectFolderUri, openInNewWindow);
	}

	private async createFlutterProject(template?: string): Promise<vs.Uri | undefined> {
		if (!this.sdks || !this.sdks.flutter) {
			this.sdkUtils.showFlutterActivationFailure("flutter.createProject");
			return;
		}

		// If already in a workspace, set the default folder to something nearby.
		const folders = await vs.window.showOpenDialog({ canSelectFolders: true, openLabel: "Select a folder to create the project in" });
		if (!folders || folders.length !== 1)
			return;
		const folderPath = fsPath(folders[0]);

		const defaultName = await this.nextAvailableName(folderPath, "flutter_application_");
		const name = await vs.window.showInputBox({ prompt: "Enter a name for your new project", placeHolder: defaultName, value: defaultName, validateInput: (s) => this.validateFlutterProjectName(s, folderPath) });
		if (!name)
			return;

		const projectFolderUri = Uri.file(path.join(folderPath, name));
		const projectFolderPath = fsPath(projectFolderUri);

		if (fs.existsSync(projectFolderPath)) {
			vs.window.showErrorMessage(`A folder named ${name} already exists in ${folderPath}`);
			return;
		}

		// Create the empty folder so we can open it.
		fs.mkdirSync(projectFolderPath);

		const triggerData: FlutterCreateTriggerData | undefined = template ? { template } : undefined;
		writeFlutterTriggerFile(projectFolderPath, triggerData);

		// If we're using a custom SDK, we need to apply it to the new project too.
		if (config.workspaceFlutterSdkPath)
			writeFlutterSdkSettingIntoProject(config.workspaceFlutterSdkPath, projectFolderPath);

		const hasFoldersOpen = !!(vs.workspace.workspaceFolders && vs.workspace.workspaceFolders.length);
		const openInNewWindow = hasFoldersOpen;
		vs.commands.executeCommand("vscode.openFolder", projectFolderUri, openInNewWindow);

		return projectFolderUri;
	}

	/**
	 * Gets a unique path or filename for the specified {folderUri} location, appending a numerical value
	 * onto the end of {prefix}, as required.
	 *
	 * A directory or file location will be generated from {prefix} with a trailing number (eg. `mydir1`) and
	 * its existence will be checked; if it already exists, the number will be incremented and checked again.
	 *
	 * This will continue until a non-existent directory and file is available, or until the maxiumum search
	 * limit (of 128) is reached.
	 *
	 * @param folder directory to check for existing directories or files.
	 * @param prefix base name of the directory or file; an integer will be placed
	 * at the end of {prefix}, starting from 1. Example: `mydir1` would become `mydir2` if `mydir1` exists.
	 */
	private async nextAvailableName(folder: string, prefix: string): Promise<string> {
		// Set an upper bound on how many attempts we should make in getting a non-existent name.
		const maxSearchLimit = 128;

		for (let index = 1; index <= maxSearchLimit; index++) {
			const name = `${prefix}${index}`;
			const fullPath = path.join(folder, name);

			if (!fs.existsSync(fullPath)) {
				// Name doesn't appear to exist on-disk and thus can be used - return it.
				return name;
			}
		}

		// We hit the search limit, so return {prefix}{index} (eg. mydir1) and allow the extension to
		// handle the already-exists condition if user doesn't change it manually.
		return `${prefix}1`;
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

	private validateDartProjectName(input: string, folderDir: string) {
		if (!packageNameRegex.test(input))
			return "Dart project names should be all lowercase, with underscores to separate words";

		const bannedNames = ["dart", "test"];
		if (bannedNames.includes(input))
			return `You may not use ${input} as the name for a dart project`;

		if (fs.existsSync(path.join(folderDir, input)))
			return `A project with this name already exists within the selected directory`;
	}

	private validateFlutterProjectName(input: string, folderDir: string) {
		if (!packageNameRegex.test(input))
			return "Flutter project names should be all lowercase, with underscores to separate words";

		const bannedNames = ["flutter", "flutter_test", "test", "integration_test"];
		if (bannedNames.includes(input))
			return `You may not use ${input} as the name for a flutter project`;

		if (fs.existsSync(path.join(folderDir, input)))
			return `A project with this name already exists within the selected directory`;
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
	public get hasStarted() {
		return this.process !== undefined;
	}

	constructor(private readonly spawn: () => SpawnedProcess, parent: ChainedProcess | undefined) {
		// We'll either start immediately, or if given a parent process only when it completes.
		if (parent) {
			// tslint:disable-next-line: no-floating-promises
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
