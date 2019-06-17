import { window } from "vscode";
import { LogCategory } from "../enums";
import { Logger, SomeError } from "../interfaces";
import { errorString } from "../utils";

export class DevTimeLogger implements Logger {
	constructor(private base: Logger) { }

	public info(message: string, category?: LogCategory): void {
		this.base.info(message, category);
	}
	public warn(errorOrMessage: SomeError, category?: LogCategory): void {
		const message = errorString(errorOrMessage);
		window.showWarningMessage(message);
		this.base.warn(errorOrMessage, category);
	}
	public error(errorOrMessage: SomeError, category?: LogCategory): void {
		const message = errorString(errorOrMessage);
		window.showErrorMessage(message);
		this.base.error(errorOrMessage, category);
	}
}
