import * as fs from "fs";
import * as path from "path";
import * as semver from "semver";
import { flutterExecutableName, isWin } from "./constants";
import { LogCategory } from "./enums";
import { Logger, SomeError } from "./interfaces";

export function uniq<T>(array: T[]): T[] {
	return array.filter((value, index) => array.indexOf(value) === index);
}

export function flatMap<T1, T2>(input: T1[], f: (input: T1) => ReadonlyArray<T2>): T2[] {
	return input.reduce((acc, x) => acc.concat(f(x)), [] as T2[]);
}

export async function flatMapAsync<T1, T2>(input: T1[], f: (input: T1) => Promise<ReadonlyArray<T2>>): Promise<T2[]> {
	let res: T2[] = [];
	for (const x of input)
		res = res.concat(await f(x));
	return res;
}

export function filenameSafe(input: string) {
	return input.replace(/[^a-z0-9]+/gi, "_").toLowerCase();
}

export function escapeRegExp(input: string): string {
	return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); // $& means the whole matched string
}

export class PromiseCompleter<T> {
	public promise: Promise<T>;
	public resolve!: (value?: T | PromiseLike<T>) => void;
	public reject!: (error?: any, stackTrace?: string) => void;

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

export function usingCustomScript(binPath: string, binArgs: string[], options?: { customScript?: string, customScriptReplacesNumArgs?: number }) {
	if (options?.customScript) {
		binPath = options.customScript;
		const numArgsToRemove = options.customScriptReplacesNumArgs !== undefined
			? options.customScriptReplacesNumArgs
			: 1; // Default to removing one arg.
		binArgs = binArgs.slice(numArgsToRemove);
	}

	return { binPath, binArgs };
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

export function notUndefined<T>(x: T | undefined): x is T {
	return x !== undefined;
}

export function asHexColor({ r, g, b, a }: { r: number, g: number, b: number, a: number }): string {
	r = clamp(r, 0, 255);
	g = clamp(g, 0, 255);
	b = clamp(b, 0, 255);
	a = clamp(a, 0, 255);

	return `${asHex(a)}${asHex(r)}${asHex(g)}${asHex(b)}`.toLowerCase();
}

export function asHex(v: number) {
	return Math.round(v).toString(16).padStart(2, "0");
}

export function clamp(v: number, min: number, max: number) {
	return Math.min(Math.max(min, v), max);
}
