
import * as vs from "vscode";
import { DartSdks, Logger } from "../../shared/interfaces";
import { notUndefined } from "../../shared/utils";
import { getDartWorkspaceFolders } from "../../shared/vscode/utils";
import { BaseTaskProvider } from "../dart/dart_task_provider";
import { isFlutterWorkspaceFolder } from "../utils";


export class FlutterTaskProvider extends BaseTaskProvider {
	static readonly type = "flutter"; // also referenced in package.json

	get type() { return FlutterTaskProvider.type; }

	constructor(logger: Logger, context: vs.ExtensionContext, sdks: DartSdks) {
		super(logger, context, sdks);
	}

	public async provideTasks(token?: vs.CancellationToken): Promise<vs.Task[]> {
		const dartProjects = getDartWorkspaceFolders();

		let promises: Array<Promise<vs.Task | undefined>> = [];
		dartProjects.forEach((folder) => {
			const isFlutter = isFlutterWorkspaceFolder(folder);
			if (isFlutter) {
				promises = promises.concat(this.createSharedTasks(folder));

				promises.push(this.createTask(folder, "flutter", ["build", "apk"]));
				promises.push(this.createTask(folder, "flutter", ["build", "ios"]));
				promises.push(this.createTask(folder, "flutter", ["build", "macos"]));
				promises.push(this.createTask(folder, "flutter", ["build", "web"]));
			}
		});

		const tasks = (await Promise.all(promises)).filter(notUndefined);

		return tasks;
	}

	protected createPubTask(folder: vs.WorkspaceFolder, args: string[]) {
		return this.createTask(folder, "flutter", ["pub", ...args]);
	}
}
