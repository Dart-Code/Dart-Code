import * as fs from "fs";
import * as path from "path";
import * as semver from "semver";
import { flutterExecutableName, isWin } from "./constants";
import { LogCategory } from "./enums";
import { Logger, SomeError } from "./interfaces";

export function forceWindowsDriveLetterToUppercase(p: string): string {
	if (p && isWin && path.isAbsolute(p) && p.charAt(0) === p.charAt(0).toLowerCase())
		p = p.substr(0, 1).toUpperCase() + p.substr(1);
	return p;
}

export function isWithinPath(file: string, folder: string) {
	const relative = path.relative(folder, file);
	return !!relative && !relative.startsWith("..") && !path.isAbsolute(relative);
}

export function uniq<T>(array: T[]): T[] {
	return array.filter((value, index) => array.indexOf(value) === index);
}

export function flatMap<T1, T2>(input: T1[], f: (input: T1) => ReadonlyArray<T2>): T2[] {
	return input.reduce((acc, x) => acc.concat(f(x)), []);
}

export function throttle(fn: (...args: any[]) => void, limitMilliseconds: number): (...args: any[]) => void {
	let timer: NodeJS.Timer;
	let lastRunTime: number;
	return (...args: any[]) => {
		const run = () => {
			lastRunTime = Date.now();
			fn(...args);
		};
		const now = Date.now();
		if (lastRunTime && now < lastRunTime + limitMilliseconds) {
			// Delay the call until the timer has expired.
			clearTimeout(timer);
			// Set the timer in future, but compensate for how far through we are.
			const runInMilliseconds = limitMilliseconds - (now - lastRunTime);
			timer = setTimeout(run, runInMilliseconds);
		} else {
			run();
		}
	};
}

export function escapeRegExp(input: string): string {
	return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); // $& means the whole matched string
}

export class PromiseCompleter<T> {
	public promise: Promise<T>;
	public resolve: (value?: T | PromiseLike<T>) => void;
	public reject: (error?: any, stackTrace?: string) => void;

	constructor() {
		this.promise = new Promise((res, rej) => {
			this.resolve = res;
			this.reject = rej;
		});
	}
}

export function findFile(file: string, startLocation: string) {
	let lastParent;
	let parent = startLocation;

	while (parent && parent.length > 1 && parent !== lastParent) {
		const child = path.join(parent, file);
		if (fs.existsSync(child))
			return child;
		lastParent = parent;
		parent = path.dirname(parent);
	}

	return undefined;
}

// TODO: Remove this, or document why we need it as well as fsPath().
export function uriToFilePath(uri: string, returnWindowsPath: boolean = isWin): string {
	let filePath = uri;
	if (uri.startsWith("file://"))
		filePath = decodeURI(uri.substring(7));
	else if (uri.startsWith("file:"))
		filePath = decodeURI(uri.substring(5)); // TODO: Does this case ever get hit? Will it be over-decoded?

	// Windows fixup.
	if (returnWindowsPath) {
		filePath = filePath.replace(/\//g, "\\");
		if (filePath[0] === "\\")
			filePath = filePath.substring(1);
	} else {
		if (filePath[0] !== "/")
			filePath = `/${filePath}`;
	}

	return filePath;
}

export function isDartSdkFromFlutter(dartSdkPath: string) {
	const possibleFlutterSdkPath = path.join(path.dirname(path.dirname(path.dirname(dartSdkPath))), "bin");
	return fs.existsSync(path.join(possibleFlutterSdkPath, flutterExecutableName));
}

export function versionIsAtLeast(inputVersion: string, requiredVersion: string): boolean {
	return semver.gte(inputVersion, requiredVersion);
}

export function isStableSdk(sdkVersion?: string): boolean {
	// We'll consider empty versions as dev; stable versions will likely always
	// be shipped with valid version files.
	return !!(sdkVersion && !semver.prerelease(sdkVersion));
}

export function errorString(error: SomeError): string {
	if (!error)
		return "<empty error>";
	else if (error instanceof Error)
		return error.message + (error.stack ? `\n${error.stack}` : "");
	else if (typeof error === "string")
		return error;
	else
		return error.message || "<empty error message>";
}

type BufferedLogMessage =
	{ type: "info", message: string, category?: LogCategory }
	| { type: "warn", message: SomeError, category?: LogCategory }
	| { type: "error", message: SomeError, category?: LogCategory };

export class BufferedLogger implements Logger {
	private buffer: BufferedLogMessage[] = [];

	public info(message: string, category?: LogCategory): void {
		this.buffer.push({ type: "info", message, category });
	}
	public warn(message: SomeError, category?: LogCategory): void {
		this.buffer.push({ type: "warn", message, category });
	}
	public error(error: SomeError, category?: LogCategory): void {
		this.buffer.push({ type: "error", message: error, category });
	}

	public flushTo(logger: Logger) {
		if (!this.buffer.length)
			return;

		logger.info("Flushing log messages...");
		for (const log of this.buffer) {
			switch (log.type) {
				case "info":
					logger.info(log.message, log.category);
					break;
				case "warn":
					logger.warn(log.message, log.category);
					break;
				case "error":
					logger.error(log.message, log.category);
					break;
			}
		}
		logger.info("Done flushing log messages...");
	}
}
