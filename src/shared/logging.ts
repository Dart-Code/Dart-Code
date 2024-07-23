import { EventEmitter } from "events";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { platformEol } from "./constants";
import { LogCategory, LogSeverity } from "./enums";
import { IAmDisposable, LogMessage, Logger, SpawnedProcess } from "./interfaces";
import { errorString } from "./utils";
import { createFolderForFile } from "./utils/fs";

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
		this.onLogEmitter.fire(new LogMessageImpl(message, severity, category));
	}

	public info(message: string, category?: LogCategory): void {
		this.log(message, LogSeverity.Info, category);
	}
	public warn(errorOrMessage: any, category?: LogCategory): void {
		this.log(errorString(errorOrMessage), LogSeverity.Warn, category);
	}
	public error(errorOrMessage: any, category?: LogCategory): void {
		this.log(errorString(errorOrMessage), LogSeverity.Error, category);
	}

	public dispose(): void {
		this.onLogEmitter.removeAllListeners();
	}
}

class LogMessageImpl implements LogMessage {
	constructor(
		readonly message: string,
		readonly severity: LogSeverity,
		readonly category: LogCategory,
	) { }

	public toLine(maxLength: number): string {
		const logMessage = (
			maxLength && this.message && this.message.length > maxLength
				? this.message.substring(0, maxLength) + "…"
				: (this.message || "<empty message>")
		).trimRight();

		const time = `[${(new Date()).toLocaleTimeString()}]`;
		const prefix = `[${LogCategory[this.category]}] [${LogSeverity[this.severity]}]`;
		return `${time} ${prefix} ${logMessage}`;
	}
}

export class CategoryLogger implements Logger {
	constructor(private base: Logger, private defaultCategory: LogCategory) { }

	public info(message: string, category: LogCategory = this.defaultCategory): void {
		this.base.info(message, category);
	}
	public warn(errorOrMessage: any, category: LogCategory = this.defaultCategory): void {
		this.base.warn(errorOrMessage, category);
	}
	public error(errorOrMessage: any, category: LogCategory = this.defaultCategory): void {
		this.base.error(errorOrMessage, category);
	}
}

class NullLogger implements Logger {
	// tslint:disable-next-line: no-empty
	public info(message: string, category?: LogCategory): void { }
	// tslint:disable-next-line: no-empty
	public warn(message: any, category?: LogCategory): void { }
	// tslint:disable-next-line: no-empty
	public error(error: any, category?: LogCategory): void { }
}

export const nullLogger = new NullLogger();

export function logProcess(logger: Logger, category: LogCategory, process: SpawnedProcess): void {
	const prefix = `(PROC ${process.pid})`;
	logger.info(`${prefix} Logging data for process...`, category);
	process.stdout.on("data", (data) => logger.info(`${prefix} ${data}`, category));
	process.stderr.on("data", (data) => logger.info(`${prefix} ${data}`, category));
	process.on("close", (code, signal) => logger.info(`${prefix} closed (${code}, ${signal})`, category));
	process.on("error", (e) => logger.info(`${prefix} errored (${e})`, category));
	process.on("exit", (code, signal) => logger.info(`${prefix} exited (${code}, ${signal})`, category));
}

export function logToConsole(logger: EmittingLogger): IAmDisposable {
	return logger.onLog((m) => {
		if (m.severity === LogSeverity.Error)
			console.error(m.toLine(1000));
		else if (m.severity === LogSeverity.Warn)
			console.warn(m.toLine(1000));
	});
}

export function captureLogs(logger: EmittingLogger, file: string, header: string, maxLogLineLength: number, logCategories: LogCategory[], excludeLogCategories = false): ({ dispose: () => Promise<void> | void }) {
	if (!file || !path.isAbsolute(file))
		throw new Error("Path passed to logTo must be an absolute path");
	const time = (detailed = false) => detailed ? `[${(new Date()).toTimeString()}] ` : `[${(new Date()).toLocaleTimeString()}] `;
	createFolderForFile(file);
	let logStream: fs.WriteStream | undefined = fs.createWriteStream(file);
	if (header)
		logStream.write(header);

	const categoryNames = logCategories.map((c) => LogCategory[c]);
	logStream.write(`${excludeLogCategories ? "Not " : ""}Logging Categories:${platformEol}    ${categoryNames.join(", ")}${platformEol}${platformEol}`);

	logStream.write(`${(new Date()).toDateString()} ${time(true)}Log file started${platformEol}`);
	let fileLogger: IAmDisposable | undefined = logger.onLog((e) => {
		if (!logStream)
			return;

		// We should log this event if:
		// - We don't have a category filter; or
		// - The category filter includes this category; or
		// - The log is WARN/ERROR (they get logged everywhere).
		const shouldLog = (excludeLogCategories
			? !logCategories.includes(e.category)
			: logCategories.includes(e.category))
			|| e.severity === LogSeverity.Warn
			|| e.severity === LogSeverity.Error;
		if (!shouldLog)
			return;

		logStream.write(`${e.toLine(maxLogLineLength)}${os.EOL}`);
	});
	return {
		async dispose(): Promise<void> {
			if (fileLogger) {
				await fileLogger.dispose();
				fileLogger = undefined;
			}
			return new Promise((resolve) => {
				if (logStream) {
					logStream.write(`${(new Date()).toDateString()} ${time(true)}Log file ended${os.EOL}`);
					logStream.once("finish", resolve);
					logStream.end();
					logStream = undefined;
				}
			});
		},
	};
}

export class RingLog {
	private readonly lines: string[];
	private pointer = 0;

	public get rawLines(): readonly string[] { return this.lines; }

	constructor(private size: number) {
		this.lines = new Array<string>(this.size);
	}

	public log(message: string) {
		this.lines[this.pointer] = message;
		this.pointer = (this.pointer + 1) % this.size;
	}

	public toString(): string {
		return this.lines.slice(this.pointer, this.size).concat(this.lines.slice(0, this.pointer)).filter((l) => l).join("\n");
	}
}
