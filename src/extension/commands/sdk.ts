import * as fs from "fs";
import * as path from "path";
import * as vs from "vscode";
import { DartCapabilities } from "../../shared/capabilities/dart";
import { dartVMPath, DART_CREATE_PROJECT_TRIGGER_FILE, flutterPath, pubPath } from "../../shared/constants";
import { LogCategory } from "../../shared/enums";
import { CustomScript, DartProjectTemplate, DartSdks, DartWorkspaceContext, IAmDisposable, Logger, SpawnedProcess } from "../../shared/interfaces";
import { logProcess } from "../../shared/logging";
import { disposeAll, nullToUndefined, PromiseCompleter, usingCustomScript } from "../../shared/utils";
import { sortBy } from "../../shared/utils/array";
import { fsPath, nextAvailableFilename } from "../../shared/utils/fs";
import { writeDartSdkSettingIntoProject } from "../../shared/utils/projects";
import { Context } from "../../shared/vscode/workspace";
import { config } from "../config";
import { PubGlobal } from "../pub/global";
import { Stagehand } from "../pub/stagehand";
import { DartCreate, DartProjectCreator } from "../sdk/dart/dart_create";
import { DartSdkManager, FlutterSdkManager } from "../sdk/sdk_manager";
import { SdkUtils } from "../sdk/utils";
import * as util from "../utils";
import { getGlobalFlutterArgs, safeToolSpawn } from "../utils/processes";
import { getFolderToRunCommandIn } from "../utils/vscode/projects";
import * as channels from "./channels";

export const packageNameRegex = new RegExp("^[a-z][a-z0-9_]*$");

// TODO: Find a better way/place for this.
export const commandState = {
	numProjectCreationsInProgress: 0,
	promptToReloadOnVersionChanges: true,
};

export class BaseSdkCommands implements IAmDisposable {
	protected readonly sdks: DartSdks;
	protected readonly disposables: vs.Disposable[] = [];

	// A map of any in-progress commands so we can terminate them if we want to run another.
	private runningCommands: { [workspaceUriAndCommand: string]: ChainedProcess | undefined } = {};

	constructor(protected readonly logger: Logger, protected readonly context: Context, protected readonly workspace: DartWorkspaceContext, protected readonly dartCapabilities: DartCapabilities) {
		this.sdks = workspace.sdks;
	}

	protected async runCommandForWorkspace(
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

	protected runFlutter(args: string[], selection: vs.Uri | undefined, alwaysShowOutput = false): Thenable<number | undefined> {
		return this.runCommandForWorkspace(this.runFlutterInFolder.bind(this), `Select the folder to run "flutter ${args.join(" ")}" in`, args, selection, alwaysShowOutput);
	}

	protected runFlutterInFolder(folder: string, args: string[], shortPath: string | undefined, alwaysShowOutput = false, customScript?: CustomScript): Thenable<number | undefined> {
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

	protected runPub(args: string[], selection: vs.Uri | undefined, alwaysShowOutput = false): Thenable<number | undefined> {
		return this.runCommandForWorkspace(this.runPubInFolder.bind(this), `Select the folder to run "pub ${args.join(" ")}" in`, args, selection, alwaysShowOutput);
	}

	protected runPubInFolder(folder: string, args: string[], shortPath: string, alwaysShowOutput = false): Thenable<number | undefined> {
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

	protected runCommandInFolder(shortPath: string | undefined, folder: string, binPath: string, args: string[], alwaysShowOutput: boolean): Thenable<number | undefined> {
		shortPath = shortPath || path.basename(folder);
		const commandName = path.basename(binPath).split(".")[0]; // Trim file extension.

		const channel = channels.getOutputChannel(`${commandName} (${shortPath})`, true);
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
			location: vs.ProgressLocation.Notification,
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
				channels.runProcessInOutputChannel(proc, channel);
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

	public dispose(): any {
		disposeAll(this.disposables);
	}
}

export class SdkCommands extends BaseSdkCommands {
	constructor(logger: Logger, context: Context, workspace: DartWorkspaceContext, private readonly sdkUtils: SdkUtils, private readonly pubGlobal: PubGlobal, dartCapabilities: DartCapabilities) {
		super(logger, context, workspace, dartCapabilities);
		const dartSdkManager = new DartSdkManager(this.logger, this.workspace.sdks);
		this.disposables.push(vs.commands.registerCommand("dart.changeSdk", () => dartSdkManager.changeSdk()));
		if (workspace.hasAnyFlutterProjects) {
			const flutterSdkManager = new FlutterSdkManager(this.logger, workspace.sdks);
			this.disposables.push(vs.commands.registerCommand("dart.changeFlutterSdk", () => flutterSdkManager.changeSdk()));
		}

		// Flutter commands.
		this.disposables.push(vs.commands.registerCommand("dart.createProject", this.createDartProject, this));
		this.disposables.push(vs.commands.registerCommand("_dart.create", this.dartCreate, this));

		// Monitor version files for SDK upgrades.
		this.setupVersionWatcher();
	}

	private dartCreate(projectPath: string, templateName: string) {
		// TODO: This should move inside DartCreate/Stagehand, but it requires extracting
		// all the command executing also into a better base class ("run pub in folder" etc.)
		// instead of being directly in here.
		if (this.dartCapabilities.supportsDartCreate) {
			const binPath = path.join(this.sdks.dart, dartVMPath);
			const projectContainer = path.dirname(projectPath);
			const projectName = path.basename(projectPath);
			const args = ["create", "-t", templateName, projectName, "--force"];
			return this.runCommandInFolder(templateName, projectContainer, binPath, args, false);
		} else {
			const args = ["global", "run", "stagehand", templateName];
			return this.runPubInFolder(projectPath, args, templateName);
		}
	}


	private async setupVersionWatcher() {
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
			if (!commandState.promptToReloadOnVersionChanges)
				return;

			const newModifiedTime = await getModifiedTimeMs();

			// Bail if we couldn't get a new modified time, or it was the same as the last one.
			if (!newModifiedTime || newModifiedTime === lastModifiedTime)
				return;

			lastModifiedTime = newModifiedTime;

			// Ensure we don't fire too often as some OSes may generate multiple events.
			commandState.promptToReloadOnVersionChanges = false;
			// Allow it again in 60 seconds.
			setTimeout(() => commandState.promptToReloadOnVersionChanges = true, 60000);

			// Wait a short period before prompting.
			setTimeout(() => util.promptToReloadExtension("Your Dart SDK has been updated. Reload using the new SDK?", undefined, false), 1000);
		});

		this.disposables.push({ dispose() { watcher.close(); } });
	}


	private async createDartProject(): Promise<void> {
		const command = "dart.createProject";
		const triggerFilename = DART_CREATE_PROJECT_TRIGGER_FILE;
		const autoPickIfSingleItem = false;

		if (!this.sdks || !this.sdks.dart) {
			this.sdkUtils.showDartActivationFailure(command);
			return;
		}

		// Get the JSON for the available templates by calling stagehand or 'dart create'.

		const creator: DartProjectCreator = this.dartCapabilities.supportsDartCreate
			? new DartCreate(this.logger, this.sdks)
			: new Stagehand(this.logger, this.sdks, this.pubGlobal);
		const isAvailable = await creator.installIfRequired();
		if (!isAvailable) {
			return;
		}
		let templates: DartProjectTemplate[];
		try {
			templates = await creator.getTemplates();
		} catch (e) {
			vs.window.showErrorMessage(`Unable to fetch project templates. ${e}`);
			return;
		}

		const sortedTemplates = sortBy(templates, (s) => s.label);
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

		const defaultName = nextAvailableFilename(folderPath, "dart_application_");
		const name = await vs.window.showInputBox({ prompt: "Enter a name for your new project", placeHolder: defaultName, value: defaultName, validateInput: (s) => this.validateDartProjectName(s, folderPath) });
		if (!name)
			return;

		const projectFolderUri = vs.Uri.file(path.join(folderPath, name));
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

		vs.commands.executeCommand("vscode.openFolder", projectFolderUri);
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
}

export function markProjectCreationStarted(): void {
	commandState.numProjectCreationsInProgress++;
}
export function markProjectCreationEnded(): void {
	commandState.numProjectCreationsInProgress--;
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
		this.process.on("close", (code) => this.completer.resolve(nullToUndefined(code)));
	}

	public cancel(): void {
		this.isCancelled = true;
	}
}
