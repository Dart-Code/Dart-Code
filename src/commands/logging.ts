import * as _ from "lodash";
import * as path from "path";
import * as vs from "vscode";
import { fsPath } from "../utils";
import { LogCategory, logTo, userSelectableLogCategories } from "../utils/log";

export const STOP_LOGGING = "Stop Logging";

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

		const selectedLogCategories = await vs.window.showQuickPick(
			Object.keys(userSelectableLogCategories).map((k) => ({
				label: k,
				logCategory: userSelectableLogCategories[k],
				picked: true,
			})),
			{
				canPickMany: true,
				placeHolder: "Select which categories to include on the log",
			},
		);
		if (!selectedLogCategories || !selectedLogCategories.length)
			return;

		const allLoggedCategories = _.concat(LogCategory.General, selectedLogCategories.map((s) => s.logCategory));

		const logger = logTo(fsPath(logUri), allLoggedCategories);
		this.disposables.push(logger);

		await vs.window.showInformationMessage(
			`Dart and Flutter logs are being written to ${fsPath(logUri)}`,
			STOP_LOGGING,
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
