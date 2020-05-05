import { DebugProtocol } from "vscode-debugprotocol";
import { forceWindowsDriveLetterToUppercase } from "../shared/utils/fs";

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

export interface DartSharedArgs {
	debugExternalLibraries: boolean;
	debuggerHandlesPathsEverywhereForBreakpoints: boolean;
	debugSdkLibraries: boolean;
	evaluateGettersInDebugViews: boolean;
	evaluateToStringInDebugViews: boolean;
	maxLogLineLength: number;
	observatoryLogFile?: string;
	sendLogsToClient?: boolean;
	showDartDeveloperLogs: boolean;
	toolEnv?: { [key: string]: string | undefined };
	useFlutterStructuredErrors: boolean;
}

export interface DartLaunchRequestArguments extends DebugProtocol.LaunchRequestArguments, DartSharedArgs {
	name: string;
	type: string;
	request: string;
	cwd?: string;
	enableAsserts: boolean;
	console: "debugConsole" | "terminal";
	dartPath: string;
	supportsDebugInternalLibraries: boolean | undefined;
	useWriteServiceInfo: boolean | undefined;
	globalFlutterArgs: string[] | undefined;
	env?: { [key: string]: string | undefined };
	program: string;
	args: string[];
	vmAdditionalArgs: string[];
	vmServicePort: number;
	webDaemonLogFile?: string;
	pubPath: string;
	pubSnapshotPath: string;
	pubTestLogFile?: string;
	showMemoryUsage: boolean;
}

export interface FlutterLaunchRequestArguments extends DartLaunchRequestArguments {
	deviceId?: string;
	deviceName?: string;
	forceFlutterVerboseMode?: boolean;
	flutterTrackWidgetCreation: boolean;
	flutterPath: string;
	flutterCustomRunScript: string | undefined;
	flutterCustomTestScript: string | undefined;
	flutterMode?: "debug" | "profile" | "release";
	flutterPlatform?: "default" | "android-arm" | "android-arm64" | "android-x86" | "android-x64";
	flutterRunLogFile?: string;
	flutterTestLogFile?: string;
	supportsExposeUrl: boolean;
	supportsWsVmService: boolean;
}

export interface DartAttachRequestArguments extends DebugProtocol.AttachRequestArguments, DartSharedArgs {
	type: string;
	request: string;
	cwd: string;
	program: string;
	packages: string;
	observatoryUri: string;
}

export interface FlutterAttachRequestArguments extends DartAttachRequestArguments {
	deviceId: string;
	flutterPath: string;
}

export interface FileLocation {
	line: number;
	column: number;
}
