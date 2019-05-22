import * as path from "path";
import * as vs from "vscode";
import { stopLoggingAction } from "../../shared/constants";
import { forceWindowsDriveLetterToUppercase } from "../../shared/utils";
import { fsPath } from "../../shared/vscode/utils";
import { LogCategory } from "../debug/utils";
import { createFolderForFile } from "../utils";
import { logTo, userSelectableLogCategories } from "../utils/log";

export let isLogging = false;

export class LoggingCommands implements vs.Disposable {
	private disposables: vs.Disposable[] = [];

	constructor(private extensionLogPath: string) {
		this.disposables.push(
			vs.commands.registerCommand("dart.startLogging", this.startLogging, this),
		);
	}

	private async startLogging(): Promise<string | undefined> {
		const logFilename = path.join(forceWindowsDriveLetterToUppercase(this.extensionLogPath), this.generateFilename());
		const logUri = vs.Uri.file(logFilename);
		createFolderForFile(logFilename);

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

		const allLoggedCategories = [LogCategory.General].concat(selectedLogCategories.map((s) => s.logCategory));

		const logger = logTo(fsPath(logUri), allLoggedCategories);
		isLogging = true;
		this.disposables.push(logger);

		await vs.window.showInformationMessage(
			`Dart and Flutter logs are being captured. Reproduce your issue then click ${stopLoggingAction}.`,
			stopLoggingAction,
		);

		isLogging = false;
		await logger.dispose();

		const doc = await vs.workspace.openTextDocument(logUri);
		await vs.window.showTextDocument(doc);

		return logFilename;
	}

	private generateFilename(): string {
		const pad = (s: string | number) => `0${s.toString()}`.slice(-2);
		const now = new Date();
		const formattedDate = `${now.getFullYear()}-${pad(now.getMonth())}-${pad(now.getDay())} ${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
		return `Dart-Code-Log-${formattedDate}.txt`;
	}

	public dispose(): any {
		for (const command of this.disposables)
			command.dispose();
	}
}
