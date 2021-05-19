import { DebugProtocol } from "vscode-debugprotocol";
import { WorkspaceConfig } from "../interfaces";

export interface DartSharedArgs {
	args?: string[];
	console?: "debugConsole" | "terminal";
	cwd?: string;
	dartSdkPath: string;
	debugExtensionBackendProtocol: "sse" | "ws";
	debugExternalLibraries: boolean;
	debugSdkLibraries: boolean;
	deleteServiceInfoFile?: boolean;
	enableAsserts?: boolean;
	env?: { [key: string]: string | undefined };
	evaluateGettersInDebugViews: boolean;
	evaluateToStringInDebugViews: boolean;
	expectSingleTest?: boolean;
	injectedClientProtocol: "sse" | "ws";
	maxLogLineLength: number;
	name: string;
	observatoryUri?: string; // For backwards compatibility
	packages?: string;
	program?: string;
	pubTestLogFile?: string;
	request: string;
	sendLogsToClient?: boolean;
	serviceInfoFile?: string;
	showDartDeveloperLogs: boolean;
	showMemoryUsage?: boolean;
	toolEnv?: { [key: string]: string | undefined };
	type: string;
	useFlutterStructuredErrors?: boolean;
	useInspectorNotificationsForWidgetErrors?: boolean;
	vmAdditionalArgs?: string[];
	vmServiceLogFile?: string;
	vmServicePort?: number;
	vmServiceUri?: string;
	webDaemonLogFile?: string;
}

export interface FlutterSharedArgs {
	deviceId?: string;
	deviceName?: string;
	forceFlutterVerboseMode?: boolean;
	flutterTrackWidgetCreation?: boolean;
	flutterSdkPath: string;
	globalFlutterArgs?: string[];
	workspaceConfig?: WorkspaceConfig;
	flutterMode?: "debug" | "profile" | "release";
	flutterPlatform?: "default" | "android-arm" | "android-arm64" | "android-x86" | "android-x64";
	flutterRunLogFile?: string;
	flutterTestLogFile?: string;
}

export interface DartLaunchRequestArguments extends DebugProtocol.LaunchRequestArguments, DartSharedArgs { }

export interface FlutterLaunchRequestArguments extends DartLaunchRequestArguments, FlutterSharedArgs { }

export interface DartAttachRequestArguments extends DebugProtocol.AttachRequestArguments, DartSharedArgs { }

export interface FlutterAttachRequestArguments extends DartAttachRequestArguments, FlutterSharedArgs { }

export interface FileLocation {
	line: number;
	column: number;
}
