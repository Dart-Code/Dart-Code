import { window } from "vscode";
import { LogCategory } from "../enums";
import { Logger, SomeError } from "../interfaces";
import { errorString } from "../utils";

export class DevTimeLogger implements Logger {
	constructor(private base: Logger) { }

	public logInfo(message: string, category?: LogCategory): void {
		this.base.logInfo(message, category);
	}
	public logWarn(errorOrMessage: SomeError, category?: LogCategory): void {
		const message = errorString(errorOrMessage);
		window.showWarningMessage(message);
		this.base.logWarn(errorOrMessage, category);
	}
	public logError(errorOrMessage: SomeError, category?: LogCategory): void {
		const message = errorString(errorOrMessage);
		window.showErrorMessage(message);
		this.base.logError(errorOrMessage, category);
	}
}
