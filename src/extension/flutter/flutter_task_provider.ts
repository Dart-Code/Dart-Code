
import * as vs from "vscode";
import { FlutterCapabilities } from "../../shared/capabilities/flutter";
import { isMac, isWin } from "../../shared/constants";
import { getFutterWebRenderer } from "../../shared/flutter/utils";
import { DartSdks, Logger } from "../../shared/interfaces";
import { notUndefined } from "../../shared/utils";
import { arrayStartsWith } from "../../shared/utils/array";
import { isFlutterProjectFolder } from "../../shared/utils/fs";
import { getAllProjectFolders } from "../../shared/vscode/utils";
import { config } from "../config";
import { BaseTaskProvider, DartTaskDefinition } from "../dart/dart_task_provider";
import * as util from "../utils";


export class FlutterTaskProvider extends BaseTaskProvider {
	static readonly type = "flutter"; // also referenced in package.json

	get type() { return FlutterTaskProvider.type; }

	constructor(logger: Logger, context: vs.ExtensionContext, sdks: DartSdks, private readonly flutterCapabilities: FlutterCapabilities) {
		super(logger, context, sdks);
		context.subscriptions.push(vs.commands.registerCommand("flutter.task.genl10n", (uri: vs.Uri) => this.runProjectTask(uri, "flutter", ["gen-l10n"])));
	}

	public async provideTasks(_token?: vs.CancellationToken): Promise<vs.Task[]> {
		const projectFolders = await getAllProjectFolders(this.logger, util.getExcludedFolders, { requirePubspec: true, searchDepth: config.projectSearchDepth });

		const promises: Array<Promise<vs.Task>> = [];
		projectFolders.forEach((folder) => {
			const folderUri = vs.Uri.file(folder);
			const workspaceFolder = vs.workspace.getWorkspaceFolder(folderUri)!;
			const isFlutter = isFlutterProjectFolder(folder);
			if (isFlutter) {
				promises.push(...this.createSharedTasks(workspaceFolder, folderUri));

				promises.push(this.createTask(workspaceFolder, folderUri, "flutter", ["build", "aar"]));
				promises.push(this.createTask(workspaceFolder, folderUri, "flutter", ["build", "apk"]));
				promises.push(this.createTask(workspaceFolder, folderUri, "flutter", ["build", "appbundle"]));
				promises.push(this.createTask(workspaceFolder, folderUri, "flutter", ["build", "bundle"]));
				if (isMac) {
					promises.push(this.createTask(workspaceFolder, folderUri, "flutter", ["build", "ios"]));
					promises.push(this.createTask(workspaceFolder, folderUri, "flutter", ["build", "ios-framework"]));
					promises.push(this.createTask(workspaceFolder, folderUri, "flutter", ["build", "ipa"]));
					promises.push(this.createTask(workspaceFolder, folderUri, "flutter", ["build", "macos"]));
				}
				promises.push(this.createTask(workspaceFolder, folderUri, "flutter", ["build", "web"]));
				if (isWin) {
					promises.push(this.createTask(workspaceFolder, folderUri, "flutter", ["build", "windows"]));
					promises.push(this.createTask(workspaceFolder, folderUri, "flutter", ["build", "winuwp"]));
				}

				promises.push(this.createTask(workspaceFolder, folderUri, "flutter", ["install"]));
				promises.push(this.createTask(workspaceFolder, folderUri, "flutter", ["gen-l10n"]));
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
