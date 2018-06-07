import * as fs from "fs";
import * as path from "path";
import { Event, EventEmitter } from "vscode";

export enum LogCategory {
	General,
	Analyzer,
	FlutterDaemon,
	FlutterRun,
	FlutterTest,
	Observatory,
}
export class LogMessage {
	constructor(public readonly message: string, public readonly category: LogCategory) { }
}

const onLogEmitter: EventEmitter<LogMessage> = new EventEmitter<LogMessage>();
export const onLog: Event<LogMessage> = onLogEmitter.event;
export function log(message: string, category = LogCategory.General) {
	onLogEmitter.fire(new LogMessage((message || "").toString().trim(), category));
}
export const debugLogTypes: { [key: string]: LogCategory } = {
	"dart.log.flutter.run": LogCategory.FlutterRun,
	"dart.log.flutter.test": LogCategory.FlutterTest,
	"dart.log.observatory": LogCategory.Observatory,
};
export function handleDebugLogEvent(event: string, message: string) {
	const cat = debugLogTypes[event];
	if (event)
		log(message, cat);
	else
		console.warn(`Failed to handle log event ${event}`);
}

export function logTo(file: string, maxLength = 1000): ({ dispose: () => Promise<void> }) {
	if (!file || !path.isAbsolute(file))
		throw new Error("Path passed to logTo must be an absolute path");
	const time = () => `[${(new Date()).toLocaleTimeString()}] `;
	let logStream = fs.createWriteStream(file);
	logStream.write(`${time()}Log file started\n`);
	let logger = onLog((e) => {
		const logMessage = e.message.length > maxLength
			? e.message.substring(0, maxLength) + "…"
			: e.message;
		const prefix = `${time()}[${LogCategory[e.category]}] `;
		logStream.write(`${prefix}${logMessage}\n`);
	});
	return {
		dispose(): Promise<void> {
			if (logger) {
				logger.dispose();
				logger = null;
			}
			if (logStream) {
				logStream.write(`${time()}Log file ended\n`);
				return new Promise((resolve) => {
					logStream.end(resolve);
					logStream = null;
				});
			}
		},
	};
}
