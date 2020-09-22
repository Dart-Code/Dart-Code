import * as path from "path";
import * as vs from "vscode";
import { dartDocPath, dartVMPath } from "../../shared/constants";
import { DartSdks } from "../../shared/interfaces";
import { fsPath } from "../../shared/utils/fs";
import { getDartWorkspaceFolders } from "../../shared/vscode/utils";
import { getToolEnv } from "../utils/processes";

export type DartTaskDefinition = vs.TaskDefinition & { command?: string, args?: string[] };
export type DartTask = vs.Task & { definition?: DartTaskDefinition };

export class DartTaskProvider implements vs.TaskProvider {
	static readonly type = "dart"; // also referenced in package.json

	constructor(private sdks: DartSdks) { }

	public provideTasks(token?: vs.CancellationToken): vs.ProviderResult<vs.Task[]> {
		const dartProjects = getDartWorkspaceFolders();

		const tasks: vs.Task[] = [];
		dartProjects.forEach((folder) => {
			tasks.push(this.createTask(folder, "dartdoc"));

			// For testing...
			// tasks.push(this.createTask(folder, "--version"));
		});

		return tasks;
	}

	private createTask(folder: vs.WorkspaceFolder, command: string) {
		return this.resolveTask(new vs.Task(
			{
				command,
				type: DartTaskProvider.type,
			} as vs.TaskDefinition,
			folder,
			command,
			DartTaskProvider.type,
		));
	}

	public resolveTask(task: DartTask, token?: vs.CancellationToken): vs.Task {
		return appendTaskExecutionInfo(this.sdks, task);
	}

}

export function appendTaskExecutionInfo(sdks: DartSdks, task: DartTask): vs.Task {
	if (!task?.definition?.command)
		return task;

	const binaryPath = task?.definition?.command === "dartdoc"
		? dartDocPath
		: dartVMPath;
	const program = path.join(sdks.dart, binaryPath);
	const args = task?.definition?.command === "dartdoc"
		? task.definition.args
		: [task?.definition?.command, ...(task.definition.args || [])];

	let cwd: string | undefined;
	switch (task.scope) {
		case vs.TaskScope.Global:
		case vs.TaskScope.Workspace:
			// We don't know how to handle these.
			return task;
		default:
			cwd = task.scope?.uri ? fsPath(task.scope.uri) : undefined;
	}

	task.execution = new vs.ProcessExecution(
		program,
		args,
		{ cwd, env: getToolEnv() },
	);

	return task;
}
