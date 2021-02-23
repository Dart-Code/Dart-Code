export enum DebuggerType {
	Dart,
	PubTest,
	Flutter,
	FlutterTest,
	Web,
	WebTest,
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
	CheckElevations = "ext.flutter.debugCheckElevationsEnabled",
	DebugPaint = "ext.flutter.debugPaint",
	Driver = "ext.flutter.driver",
	PaintBaselines = "ext.flutter.debugPaintBaselinesEnabled",
	InspectorSelectMode = "ext.flutter.inspector.show",
	InspectorSetPubRootDirectories = "ext.flutter.inspector.setPubRootDirectories",
	InspectorStructuredErrors = "ext.flutter.inspector.structuredErrors",
	BrightnessOverride = "ext.flutter.brightnessOverride",
	RepaintRainbow = "ext.flutter.repaintRainbow",
	PerformanceOverlay = "ext.flutter.showPerformanceOverlay",
	SlowAnimations = "ext.flutter.timeDilation",
}

/// The service extensions we know about and allow toggling via commands.
export enum VmService {
	HotReload = "reloadSources",
	HotRestart = "hotRestart",
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
	DevTools,
	Analyzer,
	PubTest,
	FlutterDaemon,
	FlutterRun,
	FlutterTest,
	VmService,
	WebDaemon,
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
