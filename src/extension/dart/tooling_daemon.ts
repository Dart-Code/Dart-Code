import { ExtensionContext, languages, workspace } from "vscode";
import { DartSdks, Logger } from "../../shared/interfaces";
import { DartToolingDaemon } from "../../shared/services/tooling_daemon";
import { ANALYSIS_FILTERS } from "../../shared/vscode/constants";
import { config } from "../config";
import { promptToReloadExtension } from "../utils";
import { getToolEnv } from "../utils/processes";

export class VsCodeDartToolingDaemon extends DartToolingDaemon {

	// This is static because we're not allowed to dispose/re-create them during a silent extension restart because
	// we'll generate errors (https://github.com/microsoft/vscode/issues/193443).
	// This is NOT added to the disposables, because it would be disposed during a silent restart.
	private readonly statusBarItem = languages.createLanguageStatusItem("dart.toolingDaemon", ANALYSIS_FILTERS);

	constructor(
		context: ExtensionContext,
		logger: Logger,
		sdks: DartSdks,
	) {
		super(logger, sdks, config.maxLogLineLength, getToolEnv, promptToReloadExtension);
		context.subscriptions.push(this);

		this.statusBarItem.name = "Dart Tooling Daemon";
		this.statusBarItem.text = "Dart Tooling Daemon Starting…";
		void this.connected.then(() => {
			this.statusBarItem.text = "Dart Tooling Daemon";
			this.statusBarItem.command = {
				command: "_dart.reloadExtension",
				title: "restart",
				tooltip: "Restarts the Dart Tooling Daemon",
			};
		});

		// Subscribe to event + send current/initial folders.
		context.subscriptions.push(workspace.onDidChangeWorkspaceFolders(() => this.sendWorkspaceRootsToDaemon()));
		this.sendWorkspaceRootsToDaemon();
	}

	private sendWorkspaceRootsToDaemon() {
		const workspaceFolderRootUris = workspace.workspaceFolders?.map((wf) => wf.uri.toString()) ?? [];
		void this.sendWorkspaceFolders(workspaceFolderRootUris);
	}
}
