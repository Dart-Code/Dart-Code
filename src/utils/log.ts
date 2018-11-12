import * as fs from "fs";
import * as _ from "lodash";
import * as os from "os";
import * as path from "path";
import * as vs from "vscode";
import { Event, EventEmitter } from "vscode";
import { config } from "../config";
import { LogCategory, LogMessage, LogSeverity, platformEol } from "../debug/utils";
import { getRandomInt, isDevExtension } from "../utils";

let extensionLogPath: string;
export function getExtensionLogPath() {
	extensionLogPath = extensionLogPath || config.extensionLogFile || path.join(os.tmpdir(), `dart-code-startup-log-${getRandomInt(0x1000, 0x10000).toString(16)}.txt`);
	return extensionLogPath;
}
export const userSelectableLogCategories: { [key: string]: LogCategory } = {
	"Analysis Server": LogCategory.Analyzer,
	"Debugger (Observatory)": LogCategory.Observatory,
	"Flutter Device Daemon": LogCategory.FlutterDaemon,
	"Flutter Run": LogCategory.FlutterRun,
	"Flutter Test": LogCategory.FlutterTest,
	"Pub Run Test": LogCategory.PubTest,
};

const onLogEmitter: EventEmitter<LogMessage> = new EventEmitter<LogMessage>();
export const onLog: Event<LogMessage> = onLogEmitter.event;
export function log(message: string, severity = LogSeverity.Info, category = LogCategory.General) {
	onLogEmitter.fire(new LogMessage((message || "").toString(), severity, category));
	// Warn/Error always go to General.
	if (category !== LogCategory.General && severity !== LogSeverity.Info) {
		onLogEmitter.fire(new LogMessage(`[${LogCategory[category]}] ${message}`, severity, LogCategory.General));
	}
}
export function logError(error: any, category = LogCategory.General) {
	if (!error)
		error = "Empty error";
	if (error instanceof Error)
		error = error.message + (error.stack ? `\n${error.stack}` : "");
	if (typeof error !== "string") {
		try {
			error = JSON.stringify(error);
		} catch {
			if (error.message)
				error = error.message;
			else
				error = `${error}`;
		}
	}
	if (isDevExtension)
		vs.window.showErrorMessage("DEBUG: " + error);
	console.error(error);
	log(error, LogSeverity.Error, category);
}
export function logWarn(warning: string, category = LogCategory.General) {
	if (isDevExtension)
		vs.window.showWarningMessage("DEBUG: " + warning);
	console.warn(warning);
	log(`WARN: ${warning}`, LogSeverity.Warn, category);
}
export function logInfo(info: string, category = LogCategory.General) {
	console.log(info);
	log(info, LogSeverity.Info, category);
}
export function handleDebugLogEvent(event: string, message: LogMessage) {
	if (event)
		log(message.message, message.severity, message.category);
	else
		logWarn(`Failed to handle log event ${JSON.stringify(message)}`);
}

const logHeader: string[] = [];
export function clearLogHeader() {
	logHeader.length = 0;
}
export function getLogHeader() {
	if (!logHeader.length)
		return "";
	return logHeader.join(platformEol) + platformEol + platformEol;
}
export function addToLogHeader(f: () => string) {
	try {
		logHeader.push(f().replace("\r", "").replace("\n", "\r\n"));
	} catch {
		// Don't log here; we may be trying to access things that aren't available yet.
	}
}

export function logTo(file: string, logCategories?: LogCategory[]): ({ dispose: () => Promise<void> | void }) {
	if (!file || !path.isAbsolute(file))
		throw new Error("Path passed to logTo must be an absolute path");
	const time = () => `[${(new Date()).toTimeString()}] `;
	let logStream: fs.WriteStream | undefined = fs.createWriteStream(file);
	logStream.write(getLogHeader());
	logStream.write(`${(new Date()).toDateString()} ${time()}Log file started${platformEol}`);
	let logger: vs.Disposable | undefined = onLog((e) => {
		if (logCategories && logCategories.indexOf(e.category) === -1)
			return;
		if (!logStream)
			return;

		const message = _.trimEnd(e.message);
		const maxLogLineLength = config.maxLogLineLength;
		const logMessage = maxLogLineLength && message.length > maxLogLineLength
			? message.substring(0, maxLogLineLength) + "…"
			: message;
		const prefix = `${time()}[${LogCategory[e.category]}] [${LogSeverity[e.severity]}] `;
		logStream.write(`${prefix}${logMessage}${platformEol}`);
	});
	return {
		dispose(): Promise<void> | void {
			if (logger) {
				logger.dispose();
				logger = undefined;
			}
			return new Promise((resolve) => {
				if (logStream) {
					logStream.write(`${(new Date()).toDateString()} ${time()}Log file ended${platformEol}`);
					logStream.end(resolve);
					logStream = undefined;
				}
			});
		},
	};
}
