"use strict";

import { analytics } from "../analytics";
import * as channels from "./channels";
import * as child_process from "child_process";
import * as os from "os";
import * as path from "path";
import * as project from "../project";
import * as vs from "vscode";
import { config } from "../config";
import { DebugSettings } from "../debug/utils";
import { dartPubPath } from "../utils";

export class SdkCommands {
	private sdk: string;

	constructor(sdk: string) {
		this.sdk = sdk;
	}

	registerCommands(context: vs.ExtensionContext) {
		context.subscriptions.push(vs.commands.registerCommand("dart.getDebugSettings", _ => {
			analytics.logDebuggerStart();
			let settings: DebugSettings = {
				sdkPath: this.sdk,
				debugSdkLibraries: config.debugSdkLibraries,
				debugExternalLibraries: config.debugExternalLibraries,
			};
			return JSON.stringify(settings);
		}));
		context.subscriptions.push(vs.commands.registerCommand("pub.get", selection => {
			this.runPub("get", selection);
		}));
		context.subscriptions.push(vs.commands.registerCommand("pub.upgrade", selection => {
			this.runPub("upgrade", selection);
		}));

		// Hook saving pubspec to run pub.get.
		context.subscriptions.push(vs.workspace.onDidSaveTextDocument(td => {
			if (config.runPubGetOnPubspecChanges && path.basename(td.fileName).toLowerCase() == "pubspec.yaml")
				vs.commands.executeCommand("pub.get", td.uri);
		}));
	}

	private runPub(command: string, selection?: vs.Uri) {
		let root = vs.workspace.rootPath;
		let projectPath = selection
			? path.dirname(selection.fsPath)
			: project.locateBestProjectRoot();
		let shortPath = path.join(path.basename(root), path.relative(root, projectPath));
		let channel = channels.createChannel("Pub");
		channel.show(true);

		let args = [];
		args.push(command);

		// Allow arbitrary args to be passed.
		if (config.pubAdditionalArgs)
			args = args.concat(config.pubAdditionalArgs);

		// TODO: Add a wrapper around the Dart SDK? It could do things like
		// return the paths for tools in the bin/ dir. 
		let pubPath = path.join(this.sdk, dartPubPath);
		channel.appendLine(`[${shortPath}] pub ${args.join(" ")}`);

		let process = child_process.spawn(pubPath, args, { "cwd": projectPath });
		channels.runProcessInChannel(process, channel);
	}
}
