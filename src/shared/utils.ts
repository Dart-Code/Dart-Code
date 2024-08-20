import * as fs from "fs";
import * as path from "path";
import * as semver from "semver";
import { executableNames, isWin } from "./constants";
import { LogCategory } from "./enums";
import { CustomScript, IAmDisposable, Logger } from "./interfaces";
import { ExecutionInfo } from "./processes";

export type PromiseOr<T> = Promise<T> | T;

export function uniq<T>(array: T[]): T[] {
	return array.filter((value, index) => array.indexOf(value) === index);
}

export function flatMap<T1, T2>(input: readonly T1[], f: (input: T1) => readonly T2[]): T2[] {
	return input.reduce((acc, x) => acc.concat(f(x)), [] as T2[]);
}

export async function flatMapAsync<T1, T2>(input: T1[], f: (input: T1) => Promise<readonly T2[]>): Promise<T2[]> {
	let res: T2[] = [];
	for (const x of input)
		res = res.concat(await f(x));
	return res;
}

export function filenameSafe(input: string) {
	return input.replace(/[^a-z0-9]+/gi, "_").replace(/_{2,}/g, "_").replace(/_$/g, "").toLowerCase();
}

export function escapeRegExp(input: string): string {
	return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); // $& means the whole matched string
}

export class PromiseCompleter<T> {
	public promise: Promise<T>;
	public resolve!: (value: T | PromiseLike<T>) => void;
	public reject!: (error?: any, stackTrace?: string) => void;

	constructor() {
		this.promise = new Promise((res, rej) => {
			this.resolve = res;
			this.reject = rej;
		});
	}
}

export function findFileInAncestor(files: string[], startLocation: string) {
	let lastParent;
	let parent = startLocation;

	while (parent && parent.length > 1 && parent !== lastParent) {
		for (const file of files) {
			const child = path.join(parent, file);
			if (fs.existsSync(child))
				return child;
		}
		lastParent = parent;
		parent = path.dirname(parent);
	}

	return undefined;
}

/// Converts a file URI to file path without a dependency on vs.Uri.
export function maybeUriToFilePath(uri: string | undefined, returnWindowsPath: boolean = isWin): string | undefined {
	return uri === undefined ? uri : uriToFilePath(uri);
}

/// Converts a file URI to file path without a dependency on vs.Uri.
export function uriToFilePath(uri: string, returnWindowsPath: boolean = isWin): string {
	let filePath = uri;
	if (uri.startsWith("file://"))
		filePath = decodeURI(uri.substring(7));
	else if (uri.startsWith("file:"))
		filePath = decodeURI(uri.substring(5)); // TODO: Does this case ever get hit? Will it be over-decoded?

	// Windows fixup.
	if (returnWindowsPath) {
		filePath = filePath.replace(/\//g, "\\");
		if (filePath.startsWith("\\"))
			filePath = filePath.substring(1);
	} else {
		if (!filePath.startsWith("/"))
			filePath = `/${filePath}`;
	}

	return filePath;
}

export function isDartSdkFromFlutter(dartSdkPath: string) {
	const possibleFlutterSdkPath = path.join(path.dirname(path.dirname(path.dirname(dartSdkPath))), "bin");
	return fs.existsSync(path.join(possibleFlutterSdkPath, executableNames.flutter));
}

export function versionIsAtLeast(inputVersion: string, requiredVersion: string): boolean {
	return semver.gte(inputVersion, requiredVersion);
}

export function pubVersionIsAtLeast(inputVersion: string, requiredVersion: string): boolean {
	// Standard semver gt/lt
	if (semver.gt(inputVersion, requiredVersion))
		return true;
	else if (semver.lt(inputVersion, requiredVersion))
		return false;

	// If the versions are equal, we need to handle build metadata like pub does.
	// https://github.com/dart-lang/pub_semver/

	// If only one of them has build metadata, it's newest.
	if (inputVersion.includes("+") && !requiredVersion.includes("+"))
		return true;
	if (!inputVersion.includes("+") && requiredVersion.includes("+"))
		return false;

	// Otherwise, since they're both otherwise equal and both have build
	// metadata we can treat the build metadata like pre-release by converting
	// it to pre-release (with -) or appending it to existing pre-release.
	inputVersion = inputVersion.replace("+", !inputVersion.includes("-") ? "-" : ".");
	requiredVersion = requiredVersion.replace("+", !requiredVersion.includes("-") ? "-" : ".");
	return versionIsAtLeast(inputVersion, requiredVersion);
}

export function isStableSdk(sdkVersion?: string): boolean {
	// We'll consider empty versions as dev; stable versions will likely always
	// be shipped with valid version files.
	return !!(sdkVersion && !semver.prerelease(sdkVersion));
}

export function usingCustomScript(binPath: string, binArgs: string[], customScript: CustomScript | undefined): ExecutionInfo {
	if (customScript?.script) {
		binPath = customScript.script;
		if (customScript.replacesArgs)
			binArgs = binArgs.slice(customScript.replacesArgs);
	}

	return { executable: binPath, args: binArgs };
}

export function errorString(error: any): string {
	if (!error)
		return "<empty error>";
	else if (error instanceof Error)
		return error.message + (error.stack ? `\n${error.stack}` : "");
	else if (error.message)
		return error.message;
	else if (typeof error === "string")
		return error;
	else
		return `${error}`;
}

type BufferedLogMessage =
	{ type: "info", message: string, category?: LogCategory }
	| { type: "warn", message: any, category?: LogCategory }
	| { type: "error", message: any, category?: LogCategory };

export class BufferedLogger implements Logger {
	private buffer: BufferedLogMessage[] = [];

	public info(message: string, category?: LogCategory): void {
		this.buffer.push({ type: "info", message, category });
	}
	public warn(message: any, category?: LogCategory): void {
		this.buffer.push({ type: "warn", message, category });
	}
	public error(error: any, category?: LogCategory): void {
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

export type NullAsUndefined<T> = null extends T ? NonNullable<T> | undefined : T;

export function nullToUndefined<T>(value: T): NullAsUndefined<T> {
	return (value === null ? undefined : value) as NullAsUndefined<T>;
}

export function notUndefined<T>(x: T | undefined): x is T {
	return x !== undefined;
}

export function notNull<T>(x: T | null): x is T {
	return x !== null;
}

export function notNullOrUndefined<T>(x: T | null | undefined): x is T {
	return notUndefined(x) && notNull(x);
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

export function generateTestNameFromFileName(input: string) {
	return path.basename(input).replace("_test.dart", "").replace(/_/g, " ");
}

export function escapeDartString(input: string) {
	return input.replace(/(['"\\])/g, "\\$1");
}

export function isWebDevice(deviceId: string | undefined): boolean {
	return !!(deviceId?.startsWith("web") || deviceId === "chrome" || deviceId === "edge");
}

export function disposeAll(disposables: IAmDisposable[]) {
	const toDispose = disposables.slice();
	disposables.length = 0;
	for (const d of toDispose) {
		try {
			void d.dispose();
		} catch (e) {
			console.warn(e);
		}
	}
}

export async function withTimeout<T>(promise: Thenable<T>, message: string | (() => string), seconds = 360): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		// Set a timeout to reject the promise after the timeout period.
		const timeoutTimer = setTimeout(() => {
			const msg = typeof message === "string" ? message : message();
			reject(new Error(`${msg} within ${seconds}s`));
		}, seconds * 1000);

		// When the main promise completes (or rejects), cancel the timeout and return its result.
		// eslint-disable-next-line @typescript-eslint/no-floating-promises
		promise.then(
			(result) => {
				clearTimeout(timeoutTimer);
				resolve(result);
			},
			(e) => {
				clearTimeout(timeoutTimer);
				reject(e);
			},
		);
	});
}
