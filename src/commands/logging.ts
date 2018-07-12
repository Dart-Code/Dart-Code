import * as _ from "lodash";
import * as os from "os";
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

	private lastUsedLogFolder: string;
	private async startLogging(): Promise<void> {
		const defaultFilename = this.getDefaultFilename();
		// Use last folder or inside first workspace folder.
		const defaultFolder = this.lastUsedLogFolder || (
			vs.workspace.workspaceFolders && vs.workspace.workspaceFolders.length
				? fsPath(vs.workspace.workspaceFolders[0].uri)
				: os.homedir()
		);

		const logUri = await vs.window.showSaveDialog({
			defaultUri: vs.Uri.file(path.join(defaultFolder, defaultFilename)),
			filters: {
				"Log Files": ["txt", "log"],
			},
			saveLabel: "Start Logging",
		});

		if (!logUri)
			return;

		this.lastUsedLogFolder = path.dirname(fsPath(logUri));

		const selectedLogCategories = await vs.window.showQuickPick(
			Object.keys(userSelectableLogCategories).map((k) => ({
				label: k,
				logCategory: userSelectableLogCategories[k],
				picked: true,
			})),
			{
				canPickMany: true,
				placeHolder: "Select which categories to include in the log",
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

	private getDefaultFilename(): string {
		const pad = (s: string | number) => `0${s.toString()}`.slice(-2);
		const now = new Date();
		const formattedDate = `${now.getFullYear()}-${pad(now.getMonth())}-${pad(now.getDay())} ${pad(now.getHours())}-${pad(now.getMinutes())}`;
		return `Dart-Code-Log-${formattedDate}.txt`;
	}

	public dispose(): any {
		for (const command of this.disposables)
			command.dispose();
	}
}
