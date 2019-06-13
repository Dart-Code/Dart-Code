import { window } from "vscode";
import { LogCategory } from "../enums";
import { Logger } from "../interfaces";
import { errorString } from "../utils";

export class DevTimeLogger implements Logger {
	constructor(private base: Logger) { }

	public logInfo(message: string, category?: LogCategory): void {
		this.base.logInfo(message, category);
	}
	public logWarn(message: string, category?: LogCategory): void {
		window.showWarningMessage(message);
		this.base.logWarn(message, category);
	}
	public logError(error: any, category?: LogCategory): void {
		error = errorString(error);
		window.showErrorMessage(error);
		this.base.logError(error, category);
	}
}
