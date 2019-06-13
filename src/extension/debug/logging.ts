import { Event } from "vscode-debugadapter";
import { DebugProtocol } from "vscode-debugprotocol";
import { LogCategory, LogSeverity } from "../../shared/enums";
import { Logger, LogMessage, SomeError } from "../../shared/interfaces";
import { errorString } from "../../shared/utils";

// A logger that passes log events back to the UI in `dart.log` events.
export class DebugAdapterLogger implements Logger {
	constructor(private readonly debugClient: { sendEvent: (event: DebugProtocol.Event) => void }, private readonly category: LogCategory) { }

	private log(message: string, severity: LogSeverity, category = this.category): void {
		this.debugClient.sendEvent(new Event("dart.log", { message, severity, category } as LogMessage));
	}

	public logInfo(message: string, category?: LogCategory): void {
		this.log(message, LogSeverity.Info, category);
	}
	public logWarn(message: string, category?: LogCategory): void {
		this.log(message, LogSeverity.Warn, category);
	}
	public logError(error: SomeError, category?: LogCategory): void {
		this.log(errorString(error), LogSeverity.Error, category);
	}
}
