import * as fs from "fs";
import * as _ from "lodash";
import * as path from "path";
import * as vs from "vscode";
import { Event, EventEmitter } from "vscode";
import { LogCategory, LogMessage, LogSeverity, platformEol } from "../debug/utils";
import { isDevExtension } from "../utils";

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
export function logInfo(info: string) {
	console.log(info);
	log(info, LogSeverity.Info, LogCategory.General);
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
export function addToLogHeader(f: () => string) {
	try {
		logHeader.push(f().replace("\r", "").replace("\n", "\r\n"));
	} catch {
		// Don't log here; we may be trying to access things that aren't available yet.
	}
}

export function logTo(file: string, logCategories?: LogCategory[], maxLength = 2000): ({ dispose: () => Promise<void> }) {
	if (!file || !path.isAbsolute(file))
		throw new Error("Path passed to logTo must be an absolute path");
	const time = () => `[${(new Date()).toTimeString()}] `;
	let logStream = fs.createWriteStream(file);
	logStream.write(`!! PLEASE REVIEW THIS LOG FOR SENSITIVE INFORMATION BEFORE SHARING !!${platformEol}`);
	logStream.write(`!! IT MAY CONTAIN PARTS OF YOUR PROJECT FILES                      !!${platformEol}${platformEol}`);
	logStream.write(logHeader.join(platformEol) + platformEol + platformEol);
	logStream.write(`${(new Date()).toDateString()} ${time()}Log file started${platformEol}`);
	let logger = onLog((e) => {
		if (logCategories && logCategories.indexOf(e.category) === -1)
			return;

		const message = _.trimEnd(e.message);
		const logMessage = message.length > maxLength
			? message.substring(0, maxLength) + "…"
			: message;
		const prefix = `${time()}[${LogCategory[e.category]}] [${LogSeverity[e.severity]}] `;
		logStream.write(`${prefix}${logMessage}${platformEol}`);
	});
	return {
		dispose(): Promise<void> {
			if (logger) {
				logger.dispose();
				logger = null;
			}
			if (logStream) {
				logStream.write(`${(new Date()).toDateString()} ${time()}Log file ended${platformEol}`);
				return new Promise((resolve) => {
					logStream.end(resolve);
					logStream = null;
				});
			}
		},
	};
}
