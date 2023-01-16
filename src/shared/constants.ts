import * as fs from "fs";
import { DevToolsPage } from "./interfaces";
import { versionIsAtLeast } from "./utils";

export const dartCodeExtensionIdentifier = "Dart-Code.dart-code";
export const flutterExtensionIdentifier = "Dart-Code.flutter";
export const debugAdapterPath = "out/dist/debug.js";

export const isCI = !!process.env.CI;
export const isDartCodeTestRun = !!process.env.DART_CODE_IS_TEST_RUN;
export const isWin = process.platform.startsWith("win");
export const isMac = process.platform === "darwin";
export const isLinux = !isWin && !isMac;
export const isChromeOS = isLinux && fs.existsSync("/dev/.cros_milestone");
// Used for code checks and in Dart SDK urls so Chrome OS is considered Linux.
export const dartPlatformName = isWin ? "win" : isMac ? "mac" : "linux";
// Used for display (logs, analytics) so Chrome OS is its own.
export const platformDisplayName = isWin ? "win" : isMac ? "mac" : isChromeOS ? "chromeos" : "linux";
export const platformEol = isWin ? "\r\n" : "\n";

export const androidStudioExecutableNames = isWin ? ["studio64.exe"] : ["studio.sh", "studio"];
export const executableNames = {
	dart: isWin ? "dart.exe" : "dart",
	dartdoc: isWin ? "dartdoc.bat" : "dartdoc",
	flutter: isWin ? "flutter.bat" : "flutter",
	pub: isWin ? "pub.bat" : "pub",
};
export const getExecutableName = (cmd: string) => (executableNames as { [key: string]: string | undefined })[cmd] ?? cmd;
export const dartVMPath = "bin/" + executableNames.dart;
export const dartDocPath = "bin/" + executableNames.dartdoc;
export const pubPath = "bin/" + executableNames.pub;
export const flutterPath = "bin/" + executableNames.flutter;
export const pubSnapshotPath = "bin/snapshots/pub.dart.snapshot";
export const analyzerSnapshotPath = "bin/snapshots/analysis_server.dart.snapshot";
export const androidStudioPaths = androidStudioExecutableNames.map((s) => "bin/" + s);
export const DART_DOWNLOAD_URL = "https://dart.dev/get-dart";
export const FLUTTER_DOWNLOAD_URL = "https://flutter.dev/setup/";

export const IS_LSP_CONTEXT = "dart-code:isLsp";

export const DART_DEP_PROJECT_NODE_CONTEXT = "dart-code:depProjectNode";
export const DART_DEP_DEPENDENCIES_NODE_CONTEXT = "dart-code:depDependenciesNode";
export const DART_DEP_DEV_DEPENDENCIES_NODE_CONTEXT = "dart-code:depDevDependenciesNode";
export const DART_DEP_TRANSITIVE_DEPENDENCIES_NODE_CONTEXT = "dart-code:depTransitiveDependenciesNode";
export const DART_DEP_PACKAGE_NODE_CONTEXT = "dart-code:depPackageNode";
export const DART_DEP_DEPENDENCY_PACKAGE_NODE_CONTEXT = "dart-code:depDependencyPackageNode";
export const DART_DEP_DEV_DEPENDENCY_PACKAGE_NODE_CONTEXT = "dart-code:depDevDependencyPackageNode";
export const DART_DEP_TRANSITIVE_DEPENDENCY_PACKAGE_NODE_CONTEXT = "dart-code:depTransitiveDependencyPackageNode";
export const DART_DEP_FOLDER_NODE_CONTEXT = "dart-code:depFolderNode";
export const DART_DEP_FILE_NODE_CONTEXT = "dart-code:depFileNode";
export const DART_IS_CAPTURING_LOGS_CONTEXT = "dart-code:isCapturingLogs";
export const PUB_OUTDATED_SUPPORTED_CONTEXT = "dart-code:pubOutdatedSupported";

export const IS_RUNNING_LOCALLY_CONTEXT = "dart-code:isRunningLocally";

export const stopLoggingAction = "Stop Logging";
export const showLogAction = "Show Log";
export const captureLogsMaxLineLength = 999999999;

export const restartReasonManual = "manual";
export const restartReasonSave = "save";

export const debugLaunchProgressId = "launch";
export const debugTerminatingProgressId = "terminate";

export const pubGlobalDocsUrl = "https://www.dartlang.org/tools/pub/cmd/pub-global";
export const stagehandInstallationInstructionsUrl = "https://github.com/dart-lang/stagehand#installation";

export const issueTrackerAction = "Issue Tracker";
export const issueTrackerUri = "https://github.com/Dart-Code/Dart-Code/issues";

export const wantToTryDevToolsPrompt = "Dart DevTools includes additional tools for debugging and profiling Flutter apps, including a Widget Inspector. Try it?";
export const openAction = "Open";
export const alwaysOpenAction = "Always Open";
export const notTodayAction = "Not Now";
export const doNotAskAgainAction = "Never Ask";
export const moreInfoAction = "More Info";

export const flutterSurveyDataUrl = "https://docs.flutter.dev/f/flutter-survey-metadata.json";
export const takeSurveyAction = "Take Survey";
export const skipThisSurveyAction = "Skip This Survey";

export const modifyingFilesOutsideWorkspaceInfoUrl = "https://dartcode.org/docs/modifying-files-outside-workspace/";
export const initializingFlutterMessage = "Initializing Flutter. This may take a few minutes.";

// Seconds.
export const tenSecondsInMs = 1000 * 10;

export const fiveMinutesInMs = 1000 * 60 * 5;
export const tenMinutesInMs = 1000 * 60 * 10;
export const twentyMinutesInMs = 1000 * 60 * 20;

// Hours.
export const twoHoursInMs = 1000 * 60 * 60 * 2;
export const twentyHoursInMs = 1000 * 60 * 60 * 20;
export const fortyHoursInMs = 1000 * 60 * 60 * 40;

// Duration for not showing a prompt that has been shown before.
export const noRepeatPromptThreshold = twentyHoursInMs;
export const longRepeatPromptThreshold = fortyHoursInMs;

export const pleaseReportBug = "Please raise a bug against the Dart extension for VS Code.";

export const projectSearchProgressText = "Searching for projects...";
// Search for 2s before showing progress notification.
export const projectSearchProgressNotificationDelayInMs = 2000;
export const projectSearchCacheTimeInMs = fiveMinutesInMs;

// Chrome OS exposed ports: 8000, 8008, 8080, 8085, 8888, 9005, 3000, 4200, 5000
export const CHROME_OS_DEVTOOLS_PORT = 8080;
export const CHROME_OS_VM_SERVICE_PORT = 8085;

export const DART_CREATE_PROJECT_TRIGGER_FILE = "dart.create";
export const FLUTTER_CREATE_PROJECT_TRIGGER_FILE = "flutter.create";
export const flutterCreateAvailablePlatforms = ["android", "ios", "linux", "macos", "windows", "web"];
export const flutterCreateTemplatesSupportingPlatforms = ["app", "plugin", "plugin_ffi", "skeleton"];

export const REFACTOR_FAILED_DOC_MODIFIED = "This refactor cannot be applied because the document has changed.";
export const REFACTOR_ANYWAY = "Refactor Anyway";

export const HAS_LAST_DEBUG_CONFIG = "dart-code:hasLastDebugConfig";
export const HAS_LAST_TEST_DEBUG_CONFIG = "dart-code:hasLastTestDebugConfig";
export const isInDartDebugSessionContext = "dart-code:isInDartDebugSession";
export const isInFlutterDebugModeDebugSessionContext = "dart-code:isInFlutterDebugModeDebugSession";
export const isInFlutterProfileModeDebugSessionContext = "dart-code:isInFlutterProfileModeDebugSession";
export const isInFlutterReleaseModeDebugSessionContext = "dart-code:isInFlutterReleaseModeDebugSession";
export const showErrorsAction = "Show Errors";
export const debugAnywayAction = "Debug Anyway";

export const userPromptContextPrefix = "hasPrompted.";
export const installFlutterExtensionPromptKey = "install_flutter_extension_3";
export const useRecommendedSettingsPromptKey = "use_recommended_settings";
export const yesAction = "Yes";
export const noAction = "No";
export const skipAction = "Skip";
export const iUnderstandAction = "I Understand";
export const showRecommendedSettingsAction = "Show Recommended Settings";
export const recommendedSettingsUrl = "https://dartcode.org/docs/recommended-settings/";
export const openSettingsAction = "Open Settings File";
export const reactivateDevToolsAction = "Reactivate DevTools";

export const vmServiceListeningBannerPattern: RegExp = new RegExp("(?:Observatory|The Dart VM service is) (?:listening on|.* is available at:) (http:.+)");
export const vmServiceHttpLinkPattern: RegExp = new RegExp("(http://[\\d\\.:]+/)");

export const runFlutterCreatePrompt = (platformType: string, platformNeedsGloballyEnabling: boolean) =>
	platformNeedsGloballyEnabling
		? `Enable the ${platformType} platform and add it to this project?`
		: `Add the ${platformType} platform to this project?`;
export const cancelAction = "Cancel";

export const validMethodNameRegex = new RegExp("^[a-zA-Z_][a-zA-Z0-9_]*$");
export const validClassNameRegex = validMethodNameRegex;

export const widgetInspectorPage: DevToolsPage = { id: "inspector", commandId: "dart.openDevToolsInspector", title: "Widget Inspector" };
export const cpuProfilerPage: DevToolsPage = { id: "cpu-profiler", commandId: "dart.openDevToolsCpuProfiler", title: "CPU Profiler" };
export const performancePage: DevToolsPage = {
	commandId: "dart.openDevToolsPerformance",
	id: "performance",
	routeId: (flutterVersion) => !flutterVersion || versionIsAtLeast(flutterVersion, "2.3.1" /* 2.3.0-16.0? */) ? "performance" : "legacy-performance",
	title: "Performance",
};
export const devToolsPages: DevToolsPage[] = [
	// First entry is the default page.
	widgetInspectorPage,
	cpuProfilerPage,
	{ id: "memory", commandId: "dart.openDevToolsMemory", title: "Memory" },
	performancePage,
	{ id: "network", commandId: "dart.openDevToolsNetwork", title: "Network" },
	{ id: "logging", commandId: "dart.openDevToolsLogging", title: "Logging" },
];

export const dartRecommendedConfig = {
	// Automatically format code on save and during typing of certain characters
	// (like `;` and `}`).
	"editor.formatOnSave": true,
	"editor.formatOnType": true,

	// Draw a guide line at 80 characters, where Dart's formatting will wrap code.
	"editor.rulers": [80],

	// Disables built-in highlighting of words that match your selection. Without
	// this, all instances of the selected text will be highlighted, interfering
	// with Dart's ability to highlight only exact references to the selected variable.
	"editor.selectionHighlight": false,

	// By default, VS Code prevents code completion from popping open when in
	// "snippet mode" (editing placeholders in inserted code). Setting this option
	// to `false` stops that and allows completion to open as normal, as if you
	// weren't in a snippet placeholder.
	"editor.suggest.snippetsPreventQuickSuggestions": false,

	// By default, VS Code will pre-select the most recently used item from code
	// completion. This is usually not the most relevant item.
	//
	// "first" will always select top item
	// "recentlyUsedByPrefix" will filter the recently used items based on the
	//     text immediately preceeding where completion was invoked.
	"editor.suggestSelection": "first",

	// Allows pressing <TAB> to complete snippets such as `for` even when the
	// completion list is not visible.
	"editor.tabCompletion": "onlySnippets",

	// By default, VS Code will populate code completion with words found in the
	// current file when a language service does not provide its own completions.
	// This results in code completion suggesting words when editing comments and
	// strings. This setting will prevent that.
	"editor.wordBasedSuggestions": false,
};

export const defaultLaunchJson = JSON.stringify(
	{
		"configurations": [
			{
				"name": "Dart & Flutter",
				"request": "launch",
				"type": "dart",
			},
		],
		"version": "0.2.0",
	},
	undefined, "\t"
);

// This indicates that a version is the latest possible.
export const MAX_VERSION = "999.999.999";
