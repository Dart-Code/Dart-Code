import * as child_process from "child_process";
import * as fs from "fs";
import * as path from "path";
import { DebugProtocol } from "vscode-debugprotocol";

export const dartCodeExtensionIdentifier = "Dart-Code.dart-code";
export const flutterExtensionIdentifier = "Dart-Code.flutter";
export const isWin = /^win/.test(process.platform);
export const isMac = process.platform === "darwin";
export const isLinux = !isWin && !isMac;
export const platformName = isWin ? "win" : isMac ? "mac" : "linux";
export const platformEol = isWin ? "\r\n" : "\n";

export enum LogCategory {
	General,
	CI,
	CommandProcesses,
	Analyzer,
	PubTest,
	FlutterDaemon,
	FlutterRun,
	FlutterTest,
	Observatory,
}
export enum LogSeverity {
	Info,
	Warn,
	Error,
}
export class LogMessage {
	constructor(public readonly message: string, public readonly severity: LogSeverity, public readonly category: LogCategory) { }
}

export interface IAmDisposable {
	dispose(): void;
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

export function findFile(file: string, startLocation: string) {
	let lastParent;
	let parent = startLocation;

	while (parent && parent.length > 1 && parent !== lastParent) {
		const packages = path.join(parent, file);
		if (fs.existsSync(packages))
			return packages;
		lastParent = parent;
		parent = path.dirname(parent);
	}

	return undefined;
}

export function formatPathForVm(file: string): string {
	// Handle drive letter inconsistencies.
	file = forceWindowsDriveLetterToUppercase(file);

	// Convert any Windows backslashes to forward slashes.
	file = file.replace(/\\/g, "/");

	// Remove any existing file:/(//) prefixes.
	file = file.replace(/^file:\/+/, ""); // TODO: Does this case ever get hit? Will it be over-encoded?

	// Remove any remaining leading slashes.
	file = file.replace(/^\/+/, "");

	// Ensure a single slash prefix.
	if (file.startsWith("dart:"))
		return file;
	else
		return `file:///${encodeURI(file)}`;
}

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

export function flatMap<T1, T2>(input: T1[], f: (input: T1) => T2[]): T2[] {
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

export interface DartLaunchRequestArguments extends DebugProtocol.LaunchRequestArguments {
	name: string;
	type: string;
	request: string;
	cwd: string;
	enableAsserts: boolean;
	dartPath: string;
	debugSdkLibraries: boolean;
	debugExternalLibraries: boolean;
	flutterDebuggerRestartBehaviour: "hotReload" | "hotRestart";
	evaluateGettersInDebugViews: boolean;
	env: any;
	program: string;
	args: string[];
	vmAdditionalArgs: string[];
	observatoryLogFile: string;
	maxLogLineLength: number;
	pubPath: string;
	pubSnapshotPath: string;
	pubTestLogFile: string;
	showMemoryUsage: boolean;
}

export interface FlutterLaunchRequestArguments extends DartLaunchRequestArguments {
	deviceId?: string;
	deviceName?: string;
	forceFlutterVerboseMode?: boolean;
	flutterTrackWidgetCreation: boolean;
	flutterPath: string;
	flutterMode?: "debug" | "profile" | "release";
	flutterRunLogFile: string;
	flutterTestLogFile: string;
}

export interface DartAttachRequestArguments extends DebugProtocol.AttachRequestArguments {
	type: string;
	request: string;
	cwd: string;
	debugSdkLibraries: boolean;
	debugExternalLibraries: boolean;
	packages: string;
	observatoryUri: string;
	observatoryLogFile: string;
}

export interface FlutterAttachRequestArguments extends DartAttachRequestArguments {
	deviceId: string;
	flutterPath: string;
}

export interface CoverageData {
	scriptPath: string;
	// Lines that were it. These are 1-based, unlike VS Code!
	hitLines: number[];
}

export interface FileLocation {
	line: number;
	column: number;
}
