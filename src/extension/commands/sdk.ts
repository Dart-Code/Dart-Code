import * as fs from "fs";
import * as path from "path";
import * as vs from "vscode";
import { DartCapabilities } from "../../shared/capabilities/dart";
import { dartVMPath, ExtensionRestartReason, flutterPath } from "../../shared/constants";
import { LogCategory } from "../../shared/enums";
import { CustomScript, DartSdks, DartWorkspaceContext, IAmDisposable, Logger, SpawnedProcess } from "../../shared/interfaces";
import { logProcess } from "../../shared/logging";
import { getPubExecutionInfo, RunProcessResult } from "../../shared/processes";
import { disposeAll, nullToUndefined, PromiseCompleter, usingCustomScript } from "../../shared/utils";
import { fsPath, tryGetPackageName } from "../../shared/utils/fs";
import { Context } from "../../shared/vscode/workspace";
import { config } from "../config";
import { DartSdkManager, FlutterSdkManager } from "../sdk/sdk_manager";
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

export interface OperationProgress {
	progressReporter: vs.Progress<{ message?: string; increment?: number }>;
	cancellationToken: vs.CancellationToken;
}

interface ProgressWithItemCounts extends vs.Progress<{ message?: string; increment?: number }> {
	totalItems?: number;
	currentItem?: number;
}

export function setProgressItemCounts(operationProgress: OperationProgress | undefined, totalItems: number) {
	if (!operationProgress)
		return;

	const progressWithCounts = operationProgress.progressReporter as ProgressWithItemCounts;
	progressWithCounts.totalItems = totalItems;
	progressWithCounts.currentItem = 0;
}

export class BaseSdkCommands implements IAmDisposable {
	protected readonly sdks: DartSdks;
	protected readonly disposables: vs.Disposable[] = [];

	// A map of any in-progress commands so we can terminate them if we want to run another.
	private runningCommands: Record<string, ChainedProcess | undefined> = {};

	constructor(protected readonly logger: Logger, protected readonly context: Context, protected readonly workspace: DartWorkspaceContext, protected readonly dartCapabilities: DartCapabilities) {
		this.sdks = workspace.sdks;
	}

	protected async runCommandForWorkspace(
		handler: (folder: string, args: string[], packageOrFolderDisplayName: string, alwaysShowOutput: boolean, operationProgress?: OperationProgress) => Promise<RunProcessResult | undefined>,
		placeHolder: string,
		args: string[],
		selection: vs.Uri | undefined,
		alwaysShowOutput = false,
		operationProgress?: OperationProgress,
	): Promise<RunProcessResult | undefined> {
		const folderToRunCommandIn = await getFolderToRunCommandIn(this.logger, placeHolder, selection);
		if (!folderToRunCommandIn)
			return;

		const containingWorkspace = vs.workspace.getWorkspaceFolder(vs.Uri.file(folderToRunCommandIn));
		const containingWorkspacePath = containingWorkspace ? fsPath(containingWorkspace.uri) : undefined;

		let packageOrFolderDisplayName: string;

		// Before choosing to use the folder name, try to use `package:foo`.
		const packageName = tryGetPackageName(folderToRunCommandIn);
		if (packageName) {
			packageOrFolderDisplayName = `package:${packageName}`;
		} else {
			// Display the relative path from the workspace root to the folder we're running up to two segments.
			packageOrFolderDisplayName = path.basename(folderToRunCommandIn);
			if (containingWorkspacePath) {
				const relativePath = path.relative(containingWorkspacePath, folderToRunCommandIn);
				if (relativePath) {
					packageOrFolderDisplayName = relativePath.includes(path.sep)
						? relativePath.split(path.sep).slice(-2).join(path.sep)
						: relativePath;
				}
			}
		}

		return handler(folderToRunCommandIn, args, packageOrFolderDisplayName, alwaysShowOutput, operationProgress);
	}

	protected runFlutter(args: string[], selection: vs.Uri | undefined, alwaysShowOutput = false, operationProgress?: OperationProgress): Promise<RunProcessResult | undefined> {
		return this.runCommandForWorkspace(this.runFlutterInFolder.bind(this), `Select the folder to run "flutter ${args.join(" ")}" in`, args, selection, alwaysShowOutput, operationProgress);
	}

	protected runFlutterInFolder(folder: string, args: string[], packageOrFolderDisplayName: string, alwaysShowOutput = false, operationProgress?: OperationProgress, customScript?: CustomScript): Promise<RunProcessResult | undefined> {
		if (!this.sdks.flutter)
			throw new Error("Flutter SDK not available");

		const execution = usingCustomScript(
			path.join(this.sdks.flutter, flutterPath),
			args,
			customScript,
		);

		const allArgs = getGlobalFlutterArgs()
			.concat(config.for(vs.Uri.file(folder)).flutterAdditionalArgs)
			.concat(execution.args);

		return this.runCommandInFolder(packageOrFolderDisplayName, folder, execution.executable, allArgs, alwaysShowOutput, operationProgress);
	}

	protected runPub(args: string[], selection: vs.Uri | undefined, alwaysShowOutput = false, operationProgress?: OperationProgress): Promise<RunProcessResult | undefined> {
		return this.runCommandForWorkspace(this.runPubInFolder.bind(this), `Select the folder to run "pub ${args.join(" ")}" in`, args, selection, alwaysShowOutput, operationProgress);
	}

	protected runPubInFolder(folder: string, args: string[], packageOrFolderDisplayName: string, alwaysShowOutput = false, operationProgress?: OperationProgress): Promise<RunProcessResult | undefined> {
		if (!this.sdks.dart)
			throw new Error("Dart SDK not available");

		args = args.concat(...config.for(vs.Uri.file(folder)).pubAdditionalArgs);

		const pubExecution = getPubExecutionInfo(this.dartCapabilities, this.sdks.dart, args);

		return this.runCommandInFolder(packageOrFolderDisplayName, folder, pubExecution.executable, pubExecution.args, alwaysShowOutput, operationProgress);
	}

	protected async runCommandInFolder(packageOrFolderDisplayName: string | undefined, folder: string, binPath: string, args: string[], alwaysShowOutput: boolean, operationProgress?: OperationProgress): Promise<RunProcessResult | undefined> {
		packageOrFolderDisplayName = packageOrFolderDisplayName || path.basename(folder);
		const commandName = path.basename(binPath).split(".")[0]; // Trim file extension.

		const channelName =
			commandName === packageOrFolderDisplayName
				? commandName
				: `${commandName} (${packageOrFolderDisplayName})`;
		const channel = channels.getOutputChannel(channelName, true);
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

		const runWithProgress = async (progress: vs.Progress<{ message?: string; increment?: number }>, token: vs.CancellationToken) => {
			if (existingProcess) {
				progress.report({ message: "terminating previous command..." });
				existingProcess.cancel();
			} else {
				channel.clear();
			}

			const process = new ChainedProcess(() => {
				channel.appendLine(`[${packageOrFolderDisplayName}] ${commandName} ${args.join(" ")}`);

				const progressWithCounts = progress as ProgressWithItemCounts;
				if (progressWithCounts.totalItems && progressWithCounts.totalItems > 1) {
					const current = (progressWithCounts.currentItem ?? 0) + 1;
					progressWithCounts.currentItem = current;
					progress.report({ message: `${packageOrFolderDisplayName}... (${current}/${progressWithCounts.totalItems})`, increment: 100 / progressWithCounts.totalItems });
				} else {
					progress.report({ message: `${packageOrFolderDisplayName}...` });
				}
				const proc = safeToolSpawn(folder, binPath, args);
				channels.runProcessInOutputChannel(proc, channel);
				this.logger.info(`(PROC ${proc.pid}) Spawned ${binPath} ${args.join(" ")} in ${folder}`, LogCategory.CommandProcesses);
				logProcess(this.logger, LogCategory.CommandProcesses, proc);

				// If we complete with a non-zero code, or don't complete within 10s, we should show
				// the output pane.
				const completedWithErrorPromise = new Promise((resolve) => proc.on("close", resolve));
				const timedOutPromise = new Promise((resolve) => setTimeout(() => resolve(true), 10000));
				void Promise.race([completedWithErrorPromise, timedOutPromise]).then((showOutput) => {
					if (showOutput)
						channel.show(true);
				});

				return proc;
			}, existingProcess);
			this.runningCommands[commandId] = process;
			token.onCancellationRequested(() => process.cancel());

			return process.completed;
		};

		if (operationProgress)
			return runWithProgress(operationProgress.progressReporter, operationProgress.cancellationToken);

		return await vs.window.withProgress({
			cancellable: true,
			location: vs.ProgressLocation.Notification,
			title: `${commandName} ${args.join(" ")}`,
		}, (progress, token) => runWithProgress(progress, token));
	}

	public dispose(): any {
		disposeAll(this.disposables);
	}
}

export class SdkCommands extends BaseSdkCommands {
	constructor(logger: Logger, context: Context, workspace: DartWorkspaceContext, dartCapabilities: DartCapabilities) {
		super(logger, context, workspace, dartCapabilities);
		const dartSdkManager = new DartSdkManager(this.logger, this.workspace.sdks);
		this.disposables.push(vs.commands.registerCommand("dart.changeSdk", () => dartSdkManager.changeSdk()));
		if (workspace.hasAnyFlutterProjects) {
			const flutterSdkManager = new FlutterSdkManager(this.logger, workspace.sdks);
			this.disposables.push(vs.commands.registerCommand("dart.changeFlutterSdk", () => flutterSdkManager.changeSdk()));
		}

		// Monitor version files for SDK upgrades.
		void this.setupVersionWatcher();
	}

	/// Public wrapper used by the extension API.
	public async runDartCommand(folder: string, args: string[], options?: { alwaysShowOutput?: boolean }): Promise<RunProcessResult | undefined> {
		if (!this.sdks.dart)
			throw new Error("Dart SDK not available");

		const alwaysShowOutput = options?.alwaysShowOutput ?? false;
		const dartExecutable = path.join(this.sdks.dart, dartVMPath);

		return this.runCommandInFolder(undefined, folder, dartExecutable, args, alwaysShowOutput);
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

		const watcher = fs.watch(versionFile, { persistent: false }, async () => {
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
			setTimeout(() => util.promptToReloadExtension(this.logger, {
				prompt: "Your Dart SDK has been updated. Reload using the new SDK?",
				restartReason: ExtensionRestartReason.AfterSdkVersionFileChange,
			}), 1000);
		});

		this.disposables.push({ dispose() { watcher.close(); } });
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
	private completer: PromiseCompleter<RunProcessResult | undefined> = new PromiseCompleter<RunProcessResult | undefined>();
	public readonly completed = this.completer.promise;
	private process: SpawnedProcess | undefined;
	private isCancelled = false;
	public get hasStarted() {
		return this.process !== undefined;
	}

	constructor(private readonly spawn: () => SpawnedProcess, parent: ChainedProcess | undefined) {
		// We'll either start immediately, or if given a parent process only when it completes.
		if (parent) {
			void parent.completed.then(() => this.start());
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
		this.process.stdout?.setEncoding("utf8");
		this.process.stderr?.setEncoding("utf8");

		const stdoutChunks: string[] = [];
		const stderrChunks: string[] = [];

		this.process.stdout?.on("data", (data: string) => stdoutChunks.push(data));
		this.process.stderr?.on("data", (data: string) => stderrChunks.push(data));

		this.process.on("close", (code) => {
			const result: RunProcessResult = {
				stdout: stdoutChunks.join(""),
				stderr: stderrChunks.join(""),
				exitCode: nullToUndefined(code) ?? 1, // null means terminated by signal
			};
			this.completer.resolve(result);
		});
	}

	public cancel(): void {
		this.isCancelled = true;
	}
}
