export enum DebuggerType {
	Dart,
	DartTest,
	Flutter,
	FlutterTest,
	Web,
	WebTest,
}

export function debuggerTypeFromString(debuggerType: string): DebuggerType | undefined {
	const enumKeys = Object.keys(DebuggerType).filter((key) => isNaN(Number(key))) as Array<keyof typeof DebuggerType>;
	const matchedKey = enumKeys.find((key) => key.toLowerCase() === debuggerType.toLowerCase());
	return matchedKey !== undefined
		? DebuggerType[matchedKey]
		: undefined;
}

export enum TestStatus {
	// This should be in order such that the highest number is the one to show
	// when aggregating (eg. from children).
	Waiting,
	Skipped,
	Passed,
	Unknown,
	Failed,
	Running,
}

/// The service extensions we know about.
export enum VmServiceExtension {
	PlatformOverride = "ext.flutter.platformOverride",
	DebugBanner = "ext.flutter.debugAllowBanner",
	DebugPaint = "ext.flutter.debugPaint",
	Driver = "ext.flutter.driver",
	PaintBaselines = "ext.flutter.debugPaintBaselinesEnabled",
	InspectorSelectMode = "ext.flutter.inspector.show",
	InspectorAddPubRootDirectories = "ext.flutter.inspector.addPubRootDirectories",
	InspectorSetPubRootDirectories = "ext.flutter.inspector.setPubRootDirectories",
	BrightnessOverride = "ext.flutter.brightnessOverride",
	RepaintRainbow = "ext.flutter.repaintRainbow",
	PerformanceOverlay = "ext.flutter.showPerformanceOverlay",
	SlowAnimations = "ext.flutter.timeDilation",
}

/// The service extensions we know about and allow toggling via commands.
export enum VmService {
	HotReload = "reloadSources",
	LaunchDevTools = "launchDevTools",
}

export enum VersionStatus {
	NotInstalled,
	UpdateRequired,
	UpdateAvailable,
	Valid,
}

export enum LogCategory {
	General,
	CI,
	CommandProcesses,
	DAP,
	DevTools,
	Analyzer,
	AnalyzerTiming,
	DartTest,
	FlutterDaemon,
	FlutterRun,
	FlutterTest,
	FlutterWidgetPreview,
	VmService,
	WebDaemon,
	DartToolingDaemon,
}

export enum LogSeverity {
	Info,
	Warn,
	Error,
}

export const debugOptionNames = ["my code", "my code + packages", "my code + packages + SDK", "my code + SDK"];
export enum DebugOption {
	MyCode,
	MyCodePackages,
	MyCodePackagesSdk,
	MyCodeSdk,
}
