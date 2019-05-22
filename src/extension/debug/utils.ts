import { EventEmitter } from "events";
import { DebugProtocol } from "vscode-debugprotocol";
import { LogCategory, LogSeverity } from "../../shared/enums";
import { forceWindowsDriveLetterToUppercase } from "../../shared/utils";

export class LogMessage {
	constructor(public readonly message: string, public readonly severity: LogSeverity, public readonly category: LogCategory) { }
}
export class LogEmitter extends EventEmitter {
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

export interface IAmDisposable {
	dispose(): void | Promise<void>;
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

export interface DartLaunchRequestArguments extends DebugProtocol.LaunchRequestArguments {
	name: string;
	type: string;
	request: string;
	cwd?: string;
	enableAsserts: boolean;
	dartPath: string;
	debugSdkLibraries: boolean;
	debugExternalLibraries: boolean;
	evaluateGettersInDebugViews: boolean;
	env: any;
	program: string;
	args: string[];
	vmAdditionalArgs: string[];
	vmServicePort: number;
	observatoryLogFile?: string;
	webDaemonLogFile?: string;
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
	flutterAttachSupportsUris: boolean;
	flutterPath?: string;
	flutterMode?: "debug" | "profile" | "release";
	flutterPlatform?: "default" | "android-arm" | "android-arm64" | "android-x86" | "android-x64";
	flutterRunLogFile?: string;
	flutterTestLogFile?: string;
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
