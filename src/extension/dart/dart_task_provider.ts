import * as path from "path";
import * as vs from "vscode";
import { getExecutableName } from "../../shared/constants";
import { DartSdks, Logger } from "../../shared/interfaces";
import { notUndefined } from "../../shared/utils";
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

const taskOptions: Array<[string[], DartTaskOptions]> = [
	// test must come first so it matches before the next catch-all one
	[["pub", "run", "build_runner", "test"], buildRunnerTestOptions],
	[["pub", "run", "build_runner"], buildRunnerBuildOptions],
];

export class DartTaskProvider implements vs.TaskProvider {
	static readonly type = "dart"; // also referenced in package.json

	constructor(private readonly logger: Logger, readonly context: vs.ExtensionContext, private sdks: DartSdks) {
		context.subscriptions.push(vs.commands.registerCommand("dart.task.dartdoc", (uri) => this.runTask(uri, "dartdoc", [])));
	}

	public async provideTasks(token?: vs.CancellationToken): Promise<vs.Task[]> {
		const dartProjects = getDartWorkspaceFolders();

		const promises: Array<Promise<vs.Task | undefined>> = [];
		dartProjects.forEach((folder) => {
			const isFlutter = isFlutterWorkspaceFolder(folder);
			promises.push(this.createTask(folder, "dartdoc", []));
			promises.push(this.createPubTask(folder, isFlutter, ["get"]));
			promises.push(this.createPubTask(folder, isFlutter, ["upgrade"]));
			if (referencesBuildRunner(fsPath(folder.uri))) {
				promises.push(this.createPubTask(folder, isFlutter, ["run", "build_runner", "watch"], buildRunnerBuildOptions));
				promises.push(this.createPubTask(folder, isFlutter, ["run", "build_runner", "build"], buildRunnerBuildOptions));
				promises.push(this.createPubTask(folder, isFlutter, ["run", "build_runner", "serve"], buildRunnerBuildOptions));
				promises.push(this.createPubTask(folder, isFlutter, ["run", "build_runner", "test"], buildRunnerTestOptions));
			}

			// For testing...
			// tasks.push(this.createTask(folder, "--version"));
		});

		const tasks = (await Promise.all(promises)).filter(notUndefined);

		return tasks;
	}

	public async resolveTask(task: DartTask, token?: vs.CancellationToken): Promise<vs.Task> {
		const scope: any = task.scope;
		const cwd = "uri" in scope ? fsPath((scope as vs.WorkspaceFolder).uri) : undefined;

		const newDefinition = { ...task.definition };

		// Pub commands should be run through Flutter if a Flutter project.
		if (newDefinition.command === "pub" && isFlutterProjectFolder(cwd)) {
			newDefinition.command = "flutter";
			newDefinition.args = ["pub", ...(newDefinition.args ?? [])];
		}

		const options = this.getOptions(newDefinition);
		if (options?.runtimeArgs) {
			newDefinition.args = (newDefinition.args ?? []).concat((await options?.runtimeArgs()) ?? []);
		}

		// We *must* return a new Task here, otherwise the task cannot be customised
		// in task.json.
		// https://github.com/microsoft/vscode/issues/58836#issuecomment-696620105
		const newTask: DartTask = new vs.Task(
			newDefinition,
			// This should never be undefined, but the type allows it but the constructor
			// arg does not.
			task.scope || vs.TaskScope.Workspace,
			task.name,
			task.source,
			await this.createTaskExecution(this.sdks, newDefinition, cwd),
			undefined,
		);

		newTask.problemMatchers = (newTask.problemMatchers && newTask.problemMatchers.length ? newTask.problemMatchers : options?.problemMatchers) ?? [];
		newTask.group = task.group ?? options?.group;
		newTask.isBackground = task.isBackground || (options?.isBackground ?? false);

		return newTask;
	}

	private getOptions(def: DartTaskDefinition): DartTaskOptions | undefined {
		let taskCommand = [def.command, ...(def.args ?? [])];
		// Strip "flutter" from the front for easier matching.
		if (taskCommand[0] === "flutter")
			taskCommand = taskCommand.slice(1);
		for (const knownOption of taskOptions) {
			const [command, options] = knownOption;
			if (arrayStartsWith(taskCommand, command))
				return options;
		}
	}

	private createTaskStub(folder: vs.WorkspaceFolder, command: string, args: string[]) {
		return new vs.Task(
			{ type: DartTaskProvider.type, command, args } as DartTaskDefinition,
			folder,
			[command, ...args].join(" "),
			DartTaskProvider.type,
			undefined,
			undefined
		);
	}

	private createPubTask(folder: vs.WorkspaceFolder, isFlutter: boolean, args: string[], options: DartTaskOptions = {}) {
		return this.createTask(
			folder,
			isFlutter ? "flutter" : "pub",
			isFlutter ? ["pub", ...args] : args,
		);
	}

	private async createTask(wf: vs.WorkspaceFolder, command: string, args: string[]) {
		const task = this.createTaskStub(wf, command, args);
		return this.resolveTask(task);
	}

	private async runTask(uri: vs.Uri, command: string, args: string[]) {
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

	private async createTaskExecution(sdks: DartSdks, definition: DartTaskDefinition, cwd: string | undefined): Promise<vs.ProcessExecution | undefined> {
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
