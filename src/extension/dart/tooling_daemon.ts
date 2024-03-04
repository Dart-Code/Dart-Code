import { ExtensionContext, LanguageStatusItem, commands, env, languages, workspace } from "vscode";
import { DTD_AVAILABLE } from "../../shared/constants";
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
	private static _statusBarItem: LanguageStatusItem;

	private static get statusBarItem() {
		// Create this lazily because if we create it in the static field initializer it'll run
		// even if we never create an instance of this class.
		if (!this._statusBarItem)
			this._statusBarItem = languages.createLanguageStatusItem("dart.toolingDaemon", ANALYSIS_FILTERS);
		return this._statusBarItem;
	}

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
			await env.clipboard.writeText(await this.dtdUri);

			const statusBarItem = VsCodeDartToolingDaemon.statusBarItem;
			statusBarItem.command = { ...copyUriCommand, title: "copied!" };
			setTimeout(() => statusBarItem.command = copyUriCommand, 1000);
		}));

		const statusBarItem = VsCodeDartToolingDaemon.statusBarItem;
		statusBarItem.name = "Dart Tooling Daemon";
		statusBarItem.text = "Dart Tooling Daemon Starting…";
		void this.connected.then(() => {
			void commands.executeCommand("setContext", DTD_AVAILABLE, true);
			statusBarItem.text = "Dart Tooling Daemon";
			statusBarItem.command = copyUriCommand;
		});
	}

	protected handleClose() {
		// If we failed to start up, overwrite the "Starting..." label and provide a restart option.
		const statusBarItem = VsCodeDartToolingDaemon.statusBarItem;
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
