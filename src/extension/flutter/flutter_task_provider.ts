
import * as vs from "vscode";
import { FlutterCapabilities } from "../../shared/capabilities/flutter";
import { getFutterWebRendererArg } from "../../shared/flutter/utils";
import { DartSdks, Logger } from "../../shared/interfaces";
import { notUndefined } from "../../shared/utils";
import { arrayStartsWith } from "../../shared/utils/array";
import { getDartWorkspaceFolders } from "../../shared/vscode/utils";
import { config } from "../config";
import { BaseTaskProvider, DartTaskDefinition } from "../dart/dart_task_provider";
import { isFlutterWorkspaceFolder } from "../utils";


export class FlutterTaskProvider extends BaseTaskProvider {
	static readonly type = "flutter"; // also referenced in package.json

	get type() { return FlutterTaskProvider.type; }

	constructor(logger: Logger, context: vs.ExtensionContext, sdks: DartSdks, private readonly flutterCapabilities: FlutterCapabilities) {
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

				promises.push(this.createTask(folder, "flutter", ["install"]));
			}
		});

		const tasks = (await Promise.all(promises)).filter(notUndefined);

		return tasks;
	}

	protected createPubTask(folder: vs.WorkspaceFolder, args: string[]) {
		return this.createTask(folder, "flutter", ["pub", ...args]);
	}

	protected injectArgs(definition: DartTaskDefinition): void | Promise<void> {
		definition.args = definition.args ?? [];

		if (definition.command === "flutter") {
			// Inject web-renderer if required.
			const isWebBuild = arrayStartsWith(definition.args, ["build", "web"]);
			if (isWebBuild) {
				const rendererArg = getFutterWebRendererArg(this.flutterCapabilities, config.flutterWebRenderer, definition.args);
				if (rendererArg)
					definition.args.push(rendererArg);
			}
		}
	}

}
