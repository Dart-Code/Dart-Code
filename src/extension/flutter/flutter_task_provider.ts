
import * as vs from "vscode";
import { FlutterCapabilities } from "../../shared/capabilities/flutter";
import { getFutterWebRenderer } from "../../shared/flutter/utils";
import { DartSdks, Logger } from "../../shared/interfaces";
import { notUndefined } from "../../shared/utils";
import { arrayStartsWith } from "../../shared/utils/array";
import { getAllProjectFolders } from "../../shared/vscode/utils";
import { config } from "../config";
import { BaseTaskProvider, DartTaskDefinition } from "../dart/dart_task_provider";
import * as util from "../utils";


export class FlutterTaskProvider extends BaseTaskProvider {
	static readonly type = "flutter"; // also referenced in package.json

	get type() { return FlutterTaskProvider.type; }

	constructor(logger: Logger, context: vs.ExtensionContext, sdks: DartSdks, private readonly flutterCapabilities: FlutterCapabilities) {
		super(logger, context, sdks);
	}

	public async provideTasks(token?: vs.CancellationToken): Promise<vs.Task[]> {
		const projectFolders = await getAllProjectFolders(this.logger, util.getExcludedFolders, { requirePubspec: true });

		let promises: Array<Promise<vs.Task>> = [];
		projectFolders.forEach((folder) => {
			const folderUri = vs.Uri.file(folder);
			const workspaceFolder = vs.workspace.getWorkspaceFolder(folderUri)!;
			const isFlutter = util.isFlutterProjectFolder(folder);
			if (isFlutter) {
				promises = promises.concat(this.createSharedTasks(workspaceFolder, folderUri));

				promises.push(this.createTask(workspaceFolder, folderUri, "flutter", ["build", "apk"]));
				promises.push(this.createTask(workspaceFolder, folderUri, "flutter", ["build", "ios"]));
				promises.push(this.createTask(workspaceFolder, folderUri, "flutter", ["build", "macos"]));
				promises.push(this.createTask(workspaceFolder, folderUri, "flutter", ["build", "web"]));

				promises.push(this.createTask(workspaceFolder, folderUri, "flutter", ["install"]));
			}
		});

		const tasks = (await Promise.all(promises)).filter(notUndefined);

		return tasks;
	}

	protected createPubTask(workspaceFolder: vs.WorkspaceFolder, projectFolder: vs.Uri, args: string[]) {
		return this.createTask(workspaceFolder, projectFolder, "flutter", ["pub", ...args]);
	}

	protected injectArgs(definition: DartTaskDefinition): void | Promise<void> {
		definition.args = definition.args ?? [];

		if (definition.command === "flutter") {
			// Inject web-renderer if required.
			const isWebBuild = arrayStartsWith(definition.args, ["build", "web"]);
			if (isWebBuild && !definition.args.includes("--web-renderer")) {
				const renderer = getFutterWebRenderer(this.flutterCapabilities, config.flutterWebRenderer);
				if (renderer) {
					definition.args.push("--web-renderer");
					definition.args.push(renderer);
				}
			}
		}
	}

}
