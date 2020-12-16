import * as path from "path";
import * as vs from "vscode";
import { DartCapabilities } from "../../shared/capabilities/dart";
import { getExecutableName } from "../../shared/constants";
import { DartSdks, Logger } from "../../shared/interfaces";
import { arrayStartsWith } from "../../shared/utils/array";
import { fsPath } from "../../shared/utils/fs";
import { getDartWorkspaceFolders } from "../../shared/vscode/utils";
import { config } from "../config";
import { referencesBuildRunner } from "../sdk/utils";
import { isFlutterProjectFolder, isFlutterWorkspaceFolder } from "../utils";
import { getToolEnv } from "../utils/processes";
import { getFolderToRunCommandIn } from "../utils/vscode/projects";

export type DartTaskDefinition = vs.TaskDefinition & { command?: string, args?: string[], runtimeArgs?: DartTaskRuntimeArgs };
type DartTask = vs.Task & { definition?: DartTaskDefinition };
type DartTaskRuntimeArgs = () => Promise<string[] | undefined> | string[] | undefined;
interface DartTaskOptions { isBackground?: boolean, group?: vs.TaskGroup, problemMatchers?: string[], runtimeArgs?: DartTaskRuntimeArgs }

const buildRunnerProblemMatcher = "$dart-build_runner";
const buildRunnerBuildOptions: DartTaskOptions = { problemMatchers: [buildRunnerProblemMatcher], isBackground: true, group: vs.TaskGroup.Build, runtimeArgs: () => config.buildRunnerAdditionalArgs };
const buildRunnerTestOptions: DartTaskOptions = { problemMatchers: [buildRunnerProblemMatcher], isBackground: true, group: vs.TaskGroup.Test, runtimeArgs: () => config.buildRunnerAdditionalArgs };
const flutterBuildOptions: DartTaskOptions = { isBackground: true, group: vs.TaskGroup.Build };

const taskOptions: Array<[string[], DartTaskOptions]> = [
	// test must come first so it matches before the next catch-all one
	[["pub", "run", "build_runner", "test"], buildRunnerTestOptions],
	[["pub", "run", "build_runner"], buildRunnerBuildOptions],
	[["build"], flutterBuildOptions],
];

export abstract class BaseTaskProvider implements vs.TaskProvider {
	constructor(private readonly logger: Logger, readonly context: vs.ExtensionContext, private sdks: DartSdks) { }

	abstract get type(): string;

	public abstract provideTasks(token?: vs.CancellationToken): Promise<vs.Task[]>;

	/// Tasks that will either be run by Dart or Flutter depending on the project type.
	protected createSharedTasks(folder: vs.WorkspaceFolder): Array<Promise<vs.Task>> {
		const promises: Array<Promise<vs.Task>> = [];

		promises.push(this.createPubTask(folder, ["get"]));
		promises.push(this.createPubTask(folder, ["upgrade"]));
		if (referencesBuildRunner(fsPath(folder.uri))) {
			promises.push(this.createPubTask(folder, ["run", "build_runner", "watch"]));
			promises.push(this.createPubTask(folder, ["run", "build_runner", "build"]));
			promises.push(this.createPubTask(folder, ["run", "build_runner", "serve"]));
			promises.push(this.createPubTask(folder, ["run", "build_runner", "test"]));
		}

		return promises;
	}

	public async resolveTask(task: DartTask, token?: vs.CancellationToken): Promise<vs.Task> {
		const scope: any = task.scope;
		const cwd = "uri" in scope ? fsPath((scope as vs.WorkspaceFolder).uri) : undefined;

		const definition = task.definition;

		// Pub commands should be run through Flutter if a Flutter project.
		if (definition.command === "pub" && isFlutterProjectFolder(cwd)) {
			definition.command = "flutter";
			definition.args = ["pub", ...(definition.args ?? [])];
		}

		const options = this.getOptions(definition);
		if (options?.runtimeArgs) {
			definition.args = (definition.args ?? []).concat((await options?.runtimeArgs()) ?? []);
		}

		this.injectArgs(definition);

		// We *must* return a new Task here, otherwise the task cannot be customised
		// in task.json.
		// https://github.com/microsoft/vscode/issues/58836#issuecomment-696620105
		const newTask: DartTask = new vs.Task(
			definition,
			// This should never be undefined, but the type allows it but the constructor
			// arg does not.
			task.scope || vs.TaskScope.Workspace,
			task.name,
			task.source,
			await this.createTaskExecution(this.sdks, definition, cwd),
			undefined,
		);

		newTask.problemMatchers = (newTask.problemMatchers && newTask.problemMatchers.length ? newTask.problemMatchers : options?.problemMatchers) ?? [];
		newTask.group = task.group ?? options?.group;
		newTask.isBackground = task.isBackground || (options?.isBackground ?? false);

		return newTask;
	}

	protected injectArgs(_: DartTaskDefinition): void | Promise<void> {
	}

	private getOptions(def: DartTaskDefinition): DartTaskOptions | undefined {
		let taskCommand = [def.command, ...(def.args ?? [])];
		// Strip ""dart" or flutter" from the front for easier matching.
		if (taskCommand[0] === "flutter" || taskCommand[0] === "dart")
			taskCommand = taskCommand.slice(1);
		for (const knownOption of taskOptions) {
			const [command, options] = knownOption;
			if (arrayStartsWith(taskCommand, command))
				return options;
		}
	}

	private createTaskStub(folder: vs.WorkspaceFolder, command: string, args: string[]): vs.Task {
		return new vs.Task(
			{ type: this.type, command, args } as DartTaskDefinition,
			folder,
			[command, ...args].join(" "),
			this.type,
			undefined,
			undefined
		);
	}

	protected abstract createPubTask(folder: vs.WorkspaceFolder, args: string[]): Promise<vs.Task>;

	protected async createTask(wf: vs.WorkspaceFolder, command: string, args: string[]) {
		const task = this.createTaskStub(wf, command, args);
		return this.resolveTask(task);
	}

	protected async runTask(uri: vs.Uri, command: string, args: string[]) {
		let folder = uri ? vs.workspace.getWorkspaceFolder(uri) : undefined;
		if (!folder) {
			const folderPath = await getFolderToRunCommandIn(this.logger, "Select which project to run the command for");
			if (!folderPath)
				return;
			folder = vs.workspace.getWorkspaceFolder(vs.Uri.file(folderPath));
		}
		if (!folder)
			return;

		const task = await this.createTask(folder, command, args);

		return vs.tasks.executeTask(task);
	}

	protected async createTaskExecution(sdks: DartSdks, definition: DartTaskDefinition, cwd: string | undefined): Promise<vs.ProcessExecution | undefined> {
		if (!definition.command)
			return;

		const sdk = definition.command === "flutter" && sdks.flutter ? sdks.flutter : sdks.dart;
		const executable = getExecutableName(definition.command);
		const program = path.join(sdk, "bin", executable);
		let args = definition.args ?? [];
		if (definition.runtimeArgs) {
			const runtimeArgs = await definition.runtimeArgs();
			if (runtimeArgs)
				args = args.concat(runtimeArgs);
		}

		return new vs.ProcessExecution(
			program,
			args || [],
			{ cwd, env: getToolEnv() },
		);
	}
}

export class DartTaskProvider extends BaseTaskProvider {
	static readonly type = "dart"; // also referenced in package.json

	constructor(logger: Logger, context: vs.ExtensionContext, sdks: DartSdks, private readonly dartCapabilities: DartCapabilities) {
		super(logger, context, sdks);
		context.subscriptions.push(vs.commands.registerCommand("dart.task.dartdoc", (uri) => this.runTask(uri, "dartdoc", [])));
	}

	get type() { return DartTaskProvider.type; }

	public async provideTasks(token?: vs.CancellationToken): Promise<vs.Task[]> {
		const dartProjects = getDartWorkspaceFolders();

		let promises: Array<Promise<vs.Task>> = [];
		dartProjects.forEach((folder) => {
			const isFlutter = isFlutterWorkspaceFolder(folder);
			if (!isFlutter)
				promises = promises.concat(this.createSharedTasks(folder));
			promises.push(this.createTask(folder, "dartdoc", []));

			// For testing...
			// tasks.push(this.createTask(folder, "--version"));
		});

		const tasks = (await Promise.all(promises));

		return tasks;
	}

	protected createPubTask(folder: vs.WorkspaceFolder, args: string[]) {
		if (this.dartCapabilities.supportsDartPub)
			return this.createTask(folder, "dart", ["pub", ...args]);
		else
			return this.createTask(folder, "pub", args);
	}
}
