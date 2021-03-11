import { DebugProtocol } from "vscode-debugprotocol";
import { WorkspaceConfig } from "../interfaces";

export interface DartSharedArgs {
	debugExternalLibraries: boolean;
	debugSdkLibraries: boolean;
	evaluateGettersInDebugViews: boolean;
	evaluateToStringInDebugViews: boolean;
	maxLogLineLength: number;
	vmServiceLogFile?: string;
	sendLogsToClient?: boolean;
	showDartDeveloperLogs: boolean;
	toolEnv?: { [key: string]: string | undefined };
	useFlutterStructuredErrors?: boolean;
	useInspectorNotificationsForWidgetErrors?: boolean;
	debugExtensionBackendProtocol: "sse" | "ws";
	injectedClientProtocol: "sse" | "ws";
}

export interface DartLaunchRequestArguments extends DebugProtocol.LaunchRequestArguments, DartSharedArgs {
	name: string;
	type: string;
	request: string;
	cwd?: string;
	enableAsserts?: boolean;
	console?: "debugConsole" | "terminal";
	dartSdkPath: string;
	env?: { [key: string]: string | undefined };
	program: string;
	args?: string[];
	vmAdditionalArgs?: string[];
	vmServicePort?: number;
	webDaemonLogFile?: string;
	pubTestLogFile?: string;
	showMemoryUsage?: boolean;
	expectSingleTest?: boolean;
}

export interface FlutterLaunchRequestArguments extends DartLaunchRequestArguments {
	deviceId?: string;
	deviceName?: string;
	forceFlutterVerboseMode?: boolean;
	flutterTrackWidgetCreation?: boolean;
	flutterDisableVmServiceExperimental?: boolean;
	flutterSdkPath: string;
	globalFlutterArgs?: string[];
	workspaceConfig?: WorkspaceConfig;
	flutterMode?: "debug" | "profile" | "release";
	flutterPlatform?: "default" | "android-arm" | "android-arm64" | "android-x86" | "android-x64";
	flutterRunLogFile?: string;
	flutterTestLogFile?: string;
}

export interface DartAttachRequestArguments extends DebugProtocol.AttachRequestArguments, DartSharedArgs {
	type: string;
	request: string;
	cwd: string | undefined;
	program: string | undefined;
	packages: string | undefined;
	// For backwards compatibility
	observatoryUri: string | undefined;
	vmServiceUri: string | undefined;
	serviceInfoFile: string | undefined;
	dartVersion: string;
}

export interface FlutterAttachRequestArguments extends DartAttachRequestArguments {
	deviceId: string;
	flutterPath: string;
	flutterVersion: string;
}

export interface FileLocation {
	line: number;
	column: number;
}
