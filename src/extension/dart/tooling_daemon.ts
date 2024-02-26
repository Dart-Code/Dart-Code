import { ExtensionContext, languages, workspace } from "vscode";
import { DartSdks, Logger } from "../../shared/interfaces";
import { DartToolingDaemon } from "../../shared/services/tooling_daemon";
import { ANALYSIS_FILTERS } from "../../shared/vscode/constants";
import { getDartWorkspaceFolders } from "../../shared/vscode/utils";
import { config } from "../config";
import { promptToReloadExtension } from "../utils";
import { getToolEnv } from "../utils/processes";

export class VsCodeDartToolingDaemon extends DartToolingDaemon {

	// This is static because we're not allowed to dispose/re-create them during a silent extension restart because
	// we'll generate errors (https://github.com/microsoft/vscode/issues/193443).
	// This is NOT added to the disposables, because it would be disposed during a silent restart.
	private static readonly statusBarItem = languages.createLanguageStatusItem("dart.toolingDaemon", ANALYSIS_FILTERS);

	constructor(
		context: ExtensionContext,
		logger: Logger,
		sdks: DartSdks,
	) {
		super(logger, sdks, config.maxLogLineLength, getToolEnv, promptToReloadExtension);
		context.subscriptions.push(this);

		const statusBarItem = VsCodeDartToolingDaemon.statusBarItem;
		statusBarItem.name = "Dart Tooling Daemon";
		statusBarItem.text = "Dart Tooling Daemon Starting…";
		void this.connected.then(() => {
			statusBarItem.text = "Dart Tooling Daemon";
			statusBarItem.command = {
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
		const workspaceFolderRootUris = getDartWorkspaceFolders().map((wf) => wf.uri.toString());
		void this.sendWorkspaceFolders(workspaceFolderRootUris);
	}
}
