import * as path from "path";
import * as vs from "vscode";
import { fsPath } from "../utils";
import { logTo } from "../utils/log";

export class LoggingCommands implements vs.Disposable {
	private disposables: vs.Disposable[] = [];

	constructor() {

		this.disposables.push(
			vs.commands.registerCommand("dart.startLogging", this.startLogging, this),
		);
	}

	private lastUsedLogPath: vs.Uri;
	private async startLogging(): Promise<void> {
		// Use last log file location or inside first workspace folder.
		let defaultUri = this.lastUsedLogPath;
		if (!defaultUri && vs.workspace.workspaceFolders && vs.workspace.workspaceFolders.length) {
			defaultUri = vs.Uri.file(
				path.join(
					fsPath(vs.workspace.workspaceFolders[0].uri),
					"Dart-Code-Log.txt",
				),
			);
		}

		const logUri = await vs.window.showSaveDialog({
			defaultUri,
			filters: {
				"Log Files": ["txt", "log"],
			},
			saveLabel: "Start Logging",
		});

		if (!logUri)
			return;

		this.lastUsedLogPath = logUri;

		const logger = logTo(fsPath(logUri));
		this.disposables.push(logger);

		await vs.window.showInformationMessage(
			`Dart and Flutter logs are being written to ${fsPath(logUri)}...`,
			"Stop Logging",
		);

		await logger.dispose();

		const doc = await vs.workspace.openTextDocument(logUri);
		await vs.window.showTextDocument(doc);
	}

	public dispose(): any {
		for (const command of this.disposables)
			command.dispose();
	}
}
