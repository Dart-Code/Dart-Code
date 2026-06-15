import * as fs from "fs";
import * as path from "path";
import * as semver from "semver";
import { executableNames, isWin } from "./constants";
import { LogCategory } from "./enums";
import { CustomScript, IAmDisposable, IAmDisposableAsync, Logger } from "./interfaces";
import { ExecutionInfo } from "./processes";

export type PromiseOr<T> = Promise<T> | T;

export function uniq<T>(array: T[]): T[] {
	return [...new Set(array)];
}

export function flatMap<T1, T2>(input: readonly T1[], f: (input: T1) => readonly T2[]): T2[] {
	return input.reduce((acc, x) => acc.concat(f(x)), [] as T2[]);
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

	private _isComplete = false;
	public get isComplete() { return this._isComplete; }

	constructor() {
		this.promise = new Promise((res, rej) => {
			this.resolve = (x) => {
				this._isComplete = true;
				res(x);
			};
			this.reject = (x) => {
				this._isComplete = true;
				rej(x);
			};
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
export function maybeUriToFilePath(uri: string | undefined): string | undefined {
	// TODO(dantup): Review the handling of non-file URIs passed here.
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
		return error.message as string;
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
		this.buffer.length = 0;
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

function notNull<T>(x: T | null): x is T {
	return x !== null;
}

export function notNullOrUndefined<T>(x: T | null | undefined): x is T {
	return notUndefined(x) && notNull(x);
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

/**
 * Calls dispose() on all of `disposables` which must all be synchronous disposables.
 */
export function disposeAll(disposables: IAmDisposable[]): void {
	const toDispose = disposables.slice();
	disposables.length = 0;
	for (const d of toDispose) {
		try {
			d.dispose();
		} catch (e) {
			console.warn(e);
		}
	}
}

/**
 * Calls dispose() on all of `disposables`, which can include async disposables.
 *
 * Will `await` all calls to `dispose()` but time out with printing a warning if they do not complete
 * within 3s.
 */
export async function disposeAllAsync(disposables: IAmDisposableAsync[]): Promise<void> {
	const toDispose = disposables.slice();
	disposables.length = 0;
	try {
		await withTimeout(
			Promise.allSettled(toDispose.map(async (d) => {
				try {
					await d.dispose();
				} catch (e) {
					console.warn(e);
				}
			})),
			"disposeAllAsync did not complete",
			3,
		);
	} catch (e) {
		console.warn(e);
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

/**
 * Returns a "fixed" toolEnv to work around a Copilot env var mutation issue.
 *
 * Always returns a new copy. This must be done in all tool invocations and not cached, because
 * we don't know at what point in time the Copilot SDK will mutate the process env. If we only
 * check at startup, we might be too early and assume we don't need the fix.
 *
 * Only overrides values if the last override value is explicitly what we expect. Do not
 * alter any other settings that might have been set. If the user has a complex setup then
 * they can apply the workaround manually by setting `dart.env`.
 *
 * https://github.com/Dart-Code/Dart-Code/issues/6074
 * https://github.com/Dart-Code/Dart-Code/issues/6083
 * https://github.com/microsoft/vscode/issues/320880
 * https://github.com/github/copilot-cli/issues/3602
 *
 * @param env The process environment to check for Copilot-mutated values.
 * @returns  The default toolEnv to use.
 */
export function getFixedToolEnvForCopilotMutation({ processEnv, toolEnv }: { processEnv: Record<string, string | undefined>; toolEnv: Record<string, string>; }): Record<string, string> {
	// Workaround GitHub Copilot mutating the extension host processes env variables
	// to include safe.bareRepository=explicit which breaks Swift PM.
	//
	// If the last config added was safe.bareRepository=explicit, then reduce the count to remove it.

	const newToolEnv = Object.assign({}, toolEnv);
	const configCountEnvVarValue = processEnv.GIT_CONFIG_COUNT;
	// Has a value?
	if (typeof configCountEnvVarValue === "string") {
		const configCount = parseInt(configCountEnvVarValue, 10);
		// Is numeric?
		if (Number.isInteger(configCount)) {
			const lastConfigIndex = configCount - 1;
			// Last setting is the one we're trying to eliminate?
			if (processEnv[`GIT_CONFIG_KEY_${lastConfigIndex}`] === "safe.bareRepository"
				&& processEnv[`GIT_CONFIG_VALUE_${lastConfigIndex}`] === "explicit")
				// Wind back the count to exclude it.
				newToolEnv.GIT_CONFIG_COUNT = (configCount - 1).toString();
		}
	}

	return newToolEnv;
}
