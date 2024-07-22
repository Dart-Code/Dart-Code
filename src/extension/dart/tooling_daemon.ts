import { ExtensionContext, commands, env, workspace } from "vscode";
import { DTD_AVAILABLE } from "../../shared/constants.contexts";
import { DartSdks, Logger } from "../../shared/interfaces";
import { DartToolingDaemon } from "../../shared/services/tooling_daemon";
import { ANALYSIS_FILTERS } from "../../shared/vscode/constants";
import { getLanguageStatusItem } from "../../shared/vscode/status_bar";
import { getDartWorkspaceFolders } from "../../shared/vscode/utils";
import { config } from "../config";
import { promptToReloadExtension } from "../utils";
import { getToolEnv } from "../utils/processes";

export class VsCodeDartToolingDaemon extends DartToolingDaemon {
	private readonly statusBarItem = getLanguageStatusItem("dart.toolingDaemon", ANALYSIS_FILTERS);

	constructor(
		context: ExtensionContext,
		logger: Logger,
		sdks: DartSdks,
	) {
		super(logger, sdks, config.maxLogLineLength, getToolEnv, promptToReloadExtension);
		context.subscriptions.push(this);

		this.setUpStatusBarAndCommand(context);

		// Subscribe to event + send current/initial folders.
		context.subscriptions.push(workspace.onDidChangeWorkspaceFolders(() => this.sendWorkspaceRootsToDaemon()));
		this.sendWorkspaceRootsToDaemon();
	}

	private setUpStatusBarAndCommand(context: ExtensionContext) {
		const copyUriCommand = {
			command: "dart.copyDtdUri",
			title: "copy uri",
			tooltip: "Copies the DTD endpoint URI to the clipboard",
		};

		context.subscriptions.push(commands.registerCommand("dart.copyDtdUri", async () => {
			await env.clipboard.writeText((await this.dtdUri) ?? "<dtd not available>");

			const statusBarItem = this.statusBarItem;
			statusBarItem.command = { ...copyUriCommand, title: "copied!" };
			setTimeout(() => statusBarItem.command = copyUriCommand, 1000);
		}));

		const statusBarItem = this.statusBarItem;
		statusBarItem.name = "Dart Tooling Daemon";
		statusBarItem.text = "Dart Tooling Daemon Starting…";
		void this.connected.then((connectionInfo) => {
			if (connectionInfo) {
				void commands.executeCommand("setContext", DTD_AVAILABLE, true);
				statusBarItem.text = "Dart Tooling Daemon";
				statusBarItem.command = copyUriCommand;
			}
		});
	}

	protected handleClose() {
		// If we failed to start up, overwrite the "Starting..." label and provide a restart option.
		const statusBarItem = this.statusBarItem;
		statusBarItem.text = "Dart Tooling Daemon Terminated";
		statusBarItem.command = {
			command: "_dart.reloadExtension",
			title: "restart",
		};
		super.handleClose();
	}

	private sendWorkspaceRootsToDaemon() {
		const workspaceFolderRootUris = getDartWorkspaceFolders().map((wf) => wf.uri.toString());
		void this.sendWorkspaceFolders(workspaceFolderRootUris);
	}

	public dispose() {
		void commands.executeCommand("setContext", DTD_AVAILABLE, false);
		super.dispose();
	}
}
