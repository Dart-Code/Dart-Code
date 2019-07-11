import * as child_process from "child_process";
import { EventEmitter } from "events";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { LogCategory, LogSeverity } from "./enums";
import { IAmDisposable, Logger, LogMessage, SomeError } from "./interfaces";
import { errorString } from "./utils";

class LogEmitter extends EventEmitter {
	public fire(msg: LogMessage): void {
		this.emit("log", msg);
	}
	public onLog(listener: (message: LogMessage) => void): IAmDisposable {
		this.on("log", listener);
		return {
			dispose: () => { this.removeListener("log", listener); },
		};
	}
}

export class EmittingLogger implements Logger, IAmDisposable {
	private readonly onLogEmitter = new LogEmitter();
	public readonly onLog = (listener: (message: LogMessage) => void) => this.onLogEmitter.onLog(listener);

	private log(message: string, severity: LogSeverity, category = LogCategory.General): void {
		this.onLogEmitter.fire({ message, severity, category });
		// TODO: ????
		// // Warn/Error always go to General.
		// if (category !== LogCategory.General && severity !== LogSeverity.Info) {
		// 	onLogEmitter.fire(new LogMessage(`[${LogCategory[category]}] ${message}`, severity, LogCategory.General));
		// }
	}

	public info(message: string, category?: LogCategory): void {
		this.log(message, LogSeverity.Info, category);
	}
	public warn(errorOrMessage: SomeError, category?: LogCategory): void {
		this.log(errorString(errorOrMessage), LogSeverity.Warn, category);
	}
	public error(errorOrMessage: SomeError, category?: LogCategory): void {
		this.log(errorString(errorOrMessage), LogSeverity.Error, category);
	}

	public dispose(): void {
		this.onLogEmitter.removeAllListeners();
	}
}

export class CategoryLogger implements Logger {
	constructor(private base: Logger, private defaultCategory: LogCategory) { }

	public info(message: string, category: LogCategory = this.defaultCategory): void {
		this.base.info(message, category);
	}
	public warn(errorOrMessage: SomeError, category: LogCategory = this.defaultCategory): void {
		this.base.warn(errorOrMessage, category);
	}
	public error(errorOrMessage: SomeError, category: LogCategory = this.defaultCategory): void {
		this.base.error(errorOrMessage, category);
	}
}

class NullLogger implements Logger {
	// tslint:disable-next-line: no-empty
	public info(message: string, category?: LogCategory): void { }
	// tslint:disable-next-line: no-empty
	public warn(message: SomeError, category?: LogCategory): void { }
	// tslint:disable-next-line: no-empty
	public error(error: SomeError, category?: LogCategory): void { }
}

export const nullLogger = new NullLogger();

export function logProcess(logger: Logger, category: LogCategory, process: child_process.ChildProcess): void {
	const prefix = `(PROC ${process.pid})`;
	process.stdout.on("data", (data) => logger.info(`${prefix} ${data}`, category));
	process.stderr.on("data", (data) => logger.info(`${prefix} ${data}`, category));
	process.on("close", (code) => logger.info(`${prefix} closed (${code})`, category));
	process.on("exit", (code) => logger.info(`${prefix} exited (${code})`, category));
}

export function logToConsole(logger: EmittingLogger): void {
	logger.onLog((m) => {
		if (m.severity === LogSeverity.Error)
			console.error(`[${LogCategory[m.category]}] ${m.message}`);
		else if (m.severity === LogSeverity.Warn)
			console.warn(`[${LogCategory[m.category]}] ${m.message}`);
	});
}

export function captureLogs(logger: EmittingLogger, file: string, header: string, maxLogLineLength: number, logCategories?: LogCategory[]): ({ dispose: () => Promise<void> | void }) {
	if (!file || !path.isAbsolute(file))
		throw new Error("Path passed to logTo must be an absolute path");
	const time = (detailed = false) => detailed ? `[${(new Date()).toTimeString()}] ` : `[${(new Date()).toLocaleTimeString()}] `;
	let logStream: fs.WriteStream | undefined = fs.createWriteStream(file);
	if (header)
		logStream.write(header);
	logStream.write(`${(new Date()).toDateString()} ${time(true)}Log file started${os.EOL}`);
	let fileLogger: IAmDisposable | undefined = logger.onLog((e) => {
		if (!logStream)
			return;

		// We should log this event if:
		// - We don't have a category filter; or
		// - The category filter includes this category; or
		// - The log is WARN/ERROR (they get logged everywhere).
		const shouldLog = !logCategories
			|| logCategories.indexOf(e.category) !== -1
			|| e.severity === LogSeverity.Warn
			|| e.severity === LogSeverity.Error;
		if (!shouldLog)
			return;

		const message = e.message ? e.message.trimRight() : "<empty message>";
		const logMessage = maxLogLineLength && message.length > maxLogLineLength
			? message.substring(0, maxLogLineLength) + "…"
			: message;
		const prefix = `${time()}[${LogCategory[e.category]}] [${LogSeverity[e.severity]}] `;
		logStream.write(`${prefix}${logMessage}${os.EOL}`);
	});
	return {
		dispose(): Promise<void> | void {
			if (fileLogger) {
				fileLogger.dispose();
				fileLogger = undefined;
			}
			return new Promise((resolve) => {
				if (logStream) {
					logStream.write(`${(new Date()).toDateString()} ${time(true)}Log file ended${os.EOL}`);
					logStream.end(resolve);
					logStream = undefined;
				}
			});
		},
	};
}
