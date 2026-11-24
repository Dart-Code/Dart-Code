
import * as vs from "vscode";
import { FlutterCapabilities } from "../../shared/capabilities/flutter";
import { isMac, isWin } from "../../shared/constants";
import { getFutterWebRenderer } from "../../shared/flutter/utils";
import { DartSdks, Logger } from "../../shared/interfaces";
import { arrayStartsWith } from "../../shared/utils/array";
import { config } from "../config";
import { BaseTaskProvider, DartTaskDefinition } from "../dart/dart_task_provider";


export class FlutterTaskProvider extends BaseTaskProvider {
	static readonly type = "flutter"; // also referenced in package.json

	get type() { return FlutterTaskProvider.type; }

	constructor(logger: Logger, context: vs.ExtensionContext, sdks: DartSdks, private readonly flutterCapabilities: FlutterCapabilities) {
		super(logger, context, sdks);
		context.subscriptions.push(vs.commands.registerCommand("flutter.task.genl10n", (uri: vs.Uri) => this.runProjectTask(uri, "flutter", ["gen-l10n"])));
	}

	protected createTasksForProject(workspaceFolder: vs.WorkspaceFolder, projectFolder: vs.Uri, isFlutter: boolean): Array<Promise<vs.Task>> {
		if (!isFlutter)
			return [];

		const promises = this.createSharedTasks(workspaceFolder, projectFolder);

		promises.push(this.createTask(workspaceFolder, projectFolder, "flutter", ["build", "aar"]));
		promises.push(this.createTask(workspaceFolder, projectFolder, "flutter", ["build", "apk"]));
		promises.push(this.createTask(workspaceFolder, projectFolder, "flutter", ["build", "appbundle"]));
		promises.push(this.createTask(workspaceFolder, projectFolder, "flutter", ["build", "bundle"]));
		if (isMac) {
			promises.push(this.createTask(workspaceFolder, projectFolder, "flutter", ["build", "ios"]));
			promises.push(this.createTask(workspaceFolder, projectFolder, "flutter", ["build", "ios-framework"]));
			promises.push(this.createTask(workspaceFolder, projectFolder, "flutter", ["build", "ipa"]));
			promises.push(this.createTask(workspaceFolder, projectFolder, "flutter", ["build", "macos"]));
		}
		promises.push(this.createTask(workspaceFolder, projectFolder, "flutter", ["build", "web"]));
		if (isWin) {
			promises.push(this.createTask(workspaceFolder, projectFolder, "flutter", ["build", "windows"]));
			promises.push(this.createTask(workspaceFolder, projectFolder, "flutter", ["build", "winuwp"]));
		}

		promises.push(this.createTask(workspaceFolder, projectFolder, "flutter", ["install"]));
		promises.push(this.createTask(workspaceFolder, projectFolder, "flutter", ["gen-l10n"]));

		return promises;
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
