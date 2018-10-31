import * as path from "path";
import * as vs from "vscode";
import { toolEnv } from "../debug/utils";
import { flutterPath, pubPath, referencesBuildRunner } from "../sdk/utils";
import * as util from "../utils";
import { fsPath } from "../utils";

export class PubBuildRunnerTaskProvider implements vs.TaskProvider {
	constructor(private sdks: util.Sdks) { }

	public provideTasks(token?: vs.CancellationToken): vs.ProviderResult<vs.Task[]> {
		const dartProjects = util.getDartWorkspaceFolders();

		const tasks: vs.Task[] = [];
		dartProjects.forEach((folder) => {
			if (referencesBuildRunner(fsPath(folder.uri))) {
				tasks.push(this.createBuildRunnerCommandBackgroundTask(folder, "watch"));
				tasks.push(this.createBuildRunnerCommandBackgroundTask(folder, "build"));
				tasks.push(this.createBuildRunnerCommandBackgroundTask(folder, "serve"));
				tasks.push(this.createBuildRunnerCommandBackgroundTask(folder, "test"));
			}
		});

		return tasks;
	}

	private createBuildRunnerCommandBackgroundTask(folder: vs.WorkspaceFolder, subCommand: string) {
		const isFlutter = util.isFlutterWorkspaceFolder(folder) && this.sdks.flutter;
		const type = isFlutter ? "flutter" : "pub";
		const program = isFlutter ? path.join(this.sdks.flutter, flutterPath) : path.join(this.sdks.dart, pubPath);
		const args = isFlutter ? ["packages", "pub", "run", "build_runner", subCommand] : ["run", "build_runner", subCommand];

		const task = new vs.Task(
			{
				command: subCommand,
				type,
			},
			folder,
			`build_runner ${subCommand}`,
			type,
			new vs.ProcessExecution(
				program,
				args,
				{ cwd: fsPath(folder.uri), env: toolEnv },
			),
			"dart-pub-build_runner");
		task.group = vs.TaskGroup.Build;
		task.isBackground = true;
		task.name = `build_runner ${subCommand}`;
		return task;
	}

	public resolveTask(task: vs.Task, token?: vs.CancellationToken): undefined {
		return undefined;
	}

}
