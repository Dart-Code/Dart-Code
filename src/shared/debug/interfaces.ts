
/// Launch arguments that are passed to (and understood by) the debug adapters.
export interface DartLaunchArgs {
	additionalProjectPaths?: string[];
	allowAnsiColorOutput?: boolean;
	args?: string[];
	console?: "debugConsole" | "terminal" | "externalTerminal";
	customTool?: string,
	customToolReplacesArgs?: number,
	cwd?: string;
	dartSdkPath: string;
	dartTestLogFile?: string;
	daemonPort?: number;
	debugExternalPackageLibraries: boolean;
	debugSdkLibraries: boolean;
	deleteServiceInfoFile?: boolean;
	env?: { [key: string]: string | undefined };
	evaluateGettersInDebugViews: boolean;
	showGettersInDebugViews: boolean;
	evaluateToStringInDebugViews: boolean;
	expectSingleTest?: boolean;
	flutterRunLogFile?: string;
	flutterSdkPath?: string;
	flutterTestLogFile?: string;
	maxLogLineLength: number;
	name: string;
	noDebug?: boolean;
	observatoryUri?: string; // For backwards compatibility
	omitTargetFlag?: boolean; // Flutter Bazel
	packages?: string;
	program?: string;
	request: "launch" | "attach";
	sendLogsToClient?: boolean;
	sendCustomProgressEvents?: boolean;
	showDartDeveloperLogs: boolean;
	showMemoryUsage?: boolean;
	toolEnv?: { [key: string]: string | undefined };
	type: "dart";
	useInspectorNotificationsForWidgetErrors?: boolean;
	toolArgs?: string[];
	vmAdditionalArgs?: string[];
	vmServiceInfoFile?: string;
	vmServiceLogFile?: string;
	vmServicePort?: number;
	vmServiceUri?: string;
	webDaemonLogFile?: string;
	forceEnableDebugging?: boolean; // Workaround for no VM Service. Check references to this field for info.
}

/// Launch arguments that are valid in launch.json and may be mapped into
/// DartLaunchArgs fields by the editor (in DebugConfigurationProvider).
///
/// These are not understood by the debug adapters.
export interface DartVsCodeLaunchArgs extends DartLaunchArgs {
	projectRootPath?: string;
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

export interface BasicDebugConfiguration {
	name: string;
	type: string;
	request: string;
}
