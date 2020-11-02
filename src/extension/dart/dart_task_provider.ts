import * as path from "path";
import * as vs from "vscode";
import { getExecutableName } from "../../shared/constants";
import { DartSdks } from "../../shared/interfaces";
import { notUndefined } from "../../shared/utils";
import { fsPath } from "../../shared/utils/fs";
import { getDartWorkspaceFolders } from "../../shared/vscode/utils";
import { config } from "../config";
import { referencesBuildRunner } from "../sdk/utils";
import { isFlutterWorkspaceFolder } from "../utils";
import { getToolEnv } from "../utils/processes";
import { getFolderToRunCommandIn } from "../utils/vscode/projects";

export type DartTaskDefinition = vs.TaskDefinition & { command?: string, args?: string[], runtimeArgs?: DartTaskRuntimeArgs };
type DartTask = vs.Task & { definition?: DartTaskDefinition };
type DartTaskRuntimeArgs = () => Promise<string[] | undefined> | string[] | undefined;
interface DartTaskOptions { isBackground?: boolean, group?: vs.TaskGroup, problemMatchers?: string[] | string, runtimeArgs?: DartTaskRuntimeArgs }
const buildRunnerBuildOptions: DartTaskOptions = { problemMatchers: "$dart-pub-build_runner", isBackground: true, group: vs.TaskGroup.Build, runtimeArgs: () => config.buildRunnerAdditionalArgs };
const buildRunnerTestOptions: DartTaskOptions = { problemMatchers: "$dart-pub-build_runner", isBackground: true, group: vs.TaskGroup.Test, runtimeArgs: () => config.buildRunnerAdditionalArgs };

export class DartTaskProvider implements vs.TaskProvider {
	static readonly type = "dart"; // also referenced in package.json

	constructor(private readonly context: vs.ExtensionContext, private sdks: DartSdks) {
		context.subscriptions.push(vs.commands.registerCommand("dart.task.dartdoc", (uri) => this.runImmediately(this.createDartDocTask(uri))));
	}

	private createDartDocTask(folder: vs.WorkspaceFolder | vs.Uri) {
		return this.createTask(folder, "dartdoc", []);
	}

	private async runImmediately(task: Promise<vs.Task | undefined>) {
		const t = await task;
		if (t)
			return vs.tasks.executeTask(t);
	}

	public async provideTasks(token?: vs.CancellationToken): Promise<vs.Task[]> {
		const dartProjects = getDartWorkspaceFolders();

		const promises: Array<Promise<vs.Task | undefined>> = [];
		dartProjects.forEach((folder) => {
			const isFlutter = isFlutterWorkspaceFolder(folder);
			promises.push(this.createDartDocTask(folder));
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

	private createPubTask(folder: vs.WorkspaceFolder, isFlutter: boolean, args: string[], options: DartTaskOptions = {}) {
		return this.createTask(
			folder,
			isFlutter ? "flutter" : "pub",
			isFlutter ? ["pub", ...args] : args,
			options,
		);
	}

	private async createTask(folderOrPrompt: vs.WorkspaceFolder | vs.Uri | undefined, command: string, args: string[], options: DartTaskOptions = {}) {
		if (folderOrPrompt instanceof vs.Uri || !folderOrPrompt) {
			const folder = await getFolderToRunCommandIn("Select which project to generate documentation for");
			if (!folder)
				return;
			const wf = vs.workspace.getWorkspaceFolder(vs.Uri.file(folder));
			if (!wf)
				return;
			folderOrPrompt = wf;
		}

		const task = new vs.Task(
			{
				args,
				command,
				runtimeArgs: options.runtimeArgs,
				type: DartTaskProvider.type,
			} as DartTaskDefinition,
			folderOrPrompt,
			(command === "dart" || command === "flutter" ? args : [command, ...args]).join(" "),
			DartTaskProvider.type,
			undefined,
			options.problemMatchers,
		);

		task.isBackground = options.isBackground ?? false;
		task.group = options.group;

		return this.resolveTask(task);
	}

	public async resolveTask(task: DartTask, token?: vs.CancellationToken): Promise<vs.Task> {
		const cwd = task.scope instanceof vs.Uri ? fsPath(task.scope) : undefined;
		// We *must* return a new Task here, otherwise the task cannot be customised
		// in task.json.
		// https://github.com/microsoft/vscode/issues/58836#issuecomment-696620105
		const newTask = new vs.Task(
			task.definition,
			// This should never be undefined, but the type allows it but the constructor
			// arg does not.
			task.scope || vs.TaskScope.Workspace,
			task.name,
			task.source,
			await createTaskExecution(this.sdks, task.definition, cwd),
			task.problemMatchers,
		);

		newTask.group = task.group;
		newTask.isBackground = task.isBackground;

		return newTask;
	}
}

export async function createTaskExecution(sdks: DartSdks, definition: DartTaskDefinition, cwd: string | undefined): Promise<vs.ProcessExecution | undefined> {
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
