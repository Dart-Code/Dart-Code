
export enum TestStatus {
	// This should be in order such that the highest number is the one to show
	// when aggregating (eg. from children).
	Waiting,
	Passed,
	Skipped,
	Unknown,
	Failed,
	Errored,
	Running,
}

/// The service extensions we know about.
export enum FlutterServiceExtension {
	PlatformOverride = "ext.flutter.platformOverride",
	DebugBanner = "ext.flutter.debugAllowBanner",
	CheckElevations = "ext.flutter.debugCheckElevationsEnabled",
	DebugPaint = "ext.flutter.debugPaint",
	PaintBaselines = "ext.flutter.debugPaintBaselinesEnabled",
	InspectorSelectMode = "ext.flutter.inspector.show",
	InspectorSetPubRootDirectories = "ext.flutter.inspector.setPubRootDirectories",
	RepaintRainbow = "ext.flutter.repaintRainbow",
	PerformanceOverlay = "ext.flutter.showPerformanceOverlay",
	SlowAnimations = "ext.flutter.timeDilation",
}

/// The service extensions we know about and allow toggling via commands.
export enum FlutterService {
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
	Analyzer,
	PubTest,
	FlutterDaemon,
	FlutterRun,
	FlutterTest,
	Observatory,
	WebDaemon,
}

export enum LogSeverity {
	Info,
	Warn,
	Error,
}
