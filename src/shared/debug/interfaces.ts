import { WorkspaceConfig } from "../interfaces";

/// Launch arguments that are passed to (and understood by) the debug adapters.
export interface DartLaunchArgs {
	args?: string[];
	console?: "debugConsole" | "terminal";
	cwd?: string;
	dartSdkPath: string;
	debugExternalLibraries: boolean;
	debugSdkLibraries: boolean;
	deleteServiceInfoFile?: boolean;
	env?: { [key: string]: string | undefined };
	evaluateGettersInDebugViews: boolean;
	evaluateToStringInDebugViews: boolean;
	expectSingleTest?: boolean;
	flutterRunLogFile?: string;
	flutterSdkPath?: string;
	flutterTestLogFile?: string;
	maxLogLineLength: number;
	name: string;
	noDebug?: boolean;
	observatoryUri?: string; // For backwards compatibility
	packages?: string;
	program?: string;
	pubTestLogFile?: string;
	request: "launch" | "attach";
	sendLogsToClient?: boolean;
	serviceInfoFile?: string;
	showDartDeveloperLogs: boolean;
	showMemoryUsage?: boolean;
	toolEnv?: { [key: string]: string | undefined };
	type: "dart";
	useInspectorNotificationsForWidgetErrors?: boolean;
	toolArgs?: string[];
	vmServiceLogFile?: string;
	vmServicePort?: number;
	vmServiceUri?: string;
	webDaemonLogFile?: string;
	workspaceConfig?: WorkspaceConfig;
}

/// Launch arguments that are valid in launch.json and map be mapped into
/// DartLaunchArgs fields by the editor (in DebugConfigurationProvider).
///
/// These are not understood by the debug adapters.
export interface DartVsCodeLaunchArgs extends DartLaunchArgs {
	deviceId?: string;
	deviceName?: string;
	enableAsserts?: boolean;
	flutterMode?: "debug" | "profile" | "release";
	flutterPlatform?: "default" | "android-arm" | "android-arm64" | "android-x86" | "android-x64";
}

export interface FileLocation {
	line: number;
	column: number;
}
