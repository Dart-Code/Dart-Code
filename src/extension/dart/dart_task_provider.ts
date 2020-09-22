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
		const cwd = task.scope instanceof vs.Uri ? fsPath(task.scope) : undefined;
		// We *must* return a new Task here, otherwise the task cannot be customised
		// in task.json.
		// https://github.com/microsoft/vscode/issues/58836#issuecomment-696620105
		return new vs.Task(
			task.definition,
			// This should never be undefined, but the type allows it but the constructor
			// arg does not.
			task.scope || vs.TaskScope.Workspace,
			task.name,
			task.source,
			createTaskExecution(this.sdks, task.definition, cwd),
		);
	}
}

export function createTaskExecution(sdks: DartSdks, definition: DartTaskDefinition, cwd: string | undefined): vs.ProcessExecution | undefined {
	if (!definition.command)
		return;

	const binaryPath = definition.command === "dartdoc"
		? dartDocPath
		: dartVMPath;
	const program = path.join(sdks.dart, binaryPath);
	const args = definition.command === "dartdoc"
		? definition.args
		: [definition.command, ...(definition.args || [])];

	return new vs.ProcessExecution(
		program,
		args || [],
		{ cwd, env: getToolEnv() },
	);
}
