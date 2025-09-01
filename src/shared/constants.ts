import * as fs from "fs";
import { DevToolsPage } from "./interfaces";
import { versionIsAtLeast } from "./utils";

export type SdkTypeString = "Dart" | "Flutter";

export const dartCodeExtensionIdentifier = "Dart-Code.dart-code";
export const flutterExtensionIdentifier = "Dart-Code.flutter";
export const debugAdapterPath = "out/dist/debug.js";

/// The default location of the ".dart_code" folder that holds files like autolaunch.json.
/// This can be overridden by setting the env variable named in `dartCodeConfigurationPathEnvironmentVariableName`.
export const defaultDartCodeConfigurationPath = ".dart_code";

/// The name of the environment variable that allows overriding the configuration path.
///
/// The path may be provided as a relative path (in which case it may exist within each workspace folder (not project),
/// or an absolute path (in which case there is just one for the whole workspace).
export const dartCodeConfigurationPathEnvironmentVariableName = "DART_CODE_CONFIGURATION_PATH";

/// The name of the environment variable that allows forcing a delay before starting any services
/// that must be exposed to the front-end client.
export const dartCodeServiceActivationDelayEnvironmentVariableName = "DART_CODE_SERVICE_ACTIVATION_DELAY";

/// The name of an environment variable set by Firebase Studio.
export const firebaseStudioEnvironmentVariableName = "MONOSPACE_ENV";

export const autoLaunchFilename = "autolaunch.json";

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

const androidStudioExecutableNames = isWin ? ["studio64.exe"] : ["studio", "studio.sh"];
export const executableNames = {
	dart: isWin ? "dart.exe" : "dart",
	dartdoc: isWin ? "dartdoc.bat" : "dartdoc",
	devToolsToolBinary: isWin ? "dt.bat" : "dt",
	devToolsToolLegacyBinary: isWin ? "devtools_tool.bat" : "devtools_tool",
	flutter: isWin ? "flutter.bat" : "flutter",
	flutterDev: isWin ? "flutter-dev.bat" : "flutter-dev",
	pub: isWin ? "pub.bat" : "pub",
};
export const getExecutableName = (cmd: string) => (executableNames as Record<string, string | undefined>)[cmd] ?? cmd;
export const dartVMPath = "bin/" + executableNames.dart;
export const devToolsToolPath = "tool/bin/" + executableNames.devToolsToolBinary;
export const devToolsToolLegacyPath = "tool/bin/" + executableNames.devToolsToolLegacyBinary;

export let flutterPath = "bin/" + executableNames.flutter;
export function setFlutterDev(useFlutterDev: boolean) {
	flutterPath = "bin/" + (useFlutterDev ? executableNames.flutterDev : executableNames.flutter);
}

export const analyzerSnapshotPath = "bin/snapshots/analysis_server.dart.snapshot";
export const androidStudioPaths = androidStudioExecutableNames.map((s) => "bin/" + s);
export const DART_DOWNLOAD_URL = "https://dart.dev/get-dart";
export const FLUTTER_DOWNLOAD_URL = "https://flutter.dev/setup/";

export const showLogAction = "Show Log";
export const captureLogsMaxLineLength = 999999999;

export const restartReasonManual = "manual";
export const restartReasonSave = "save";

export const debugLaunchProgressId = "launch";
export const debugTerminatingProgressId = "terminate";

export const pubGlobalDocsUrl = "https://dart.dev/tools/pub/cmd/pub-global";

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

export const noSdkAvailablePrompt = "No SDK is available to add to PATH";
export const sdkAlreadyOnPathPrompt = (sdkType: SdkTypeString) => `The ${sdkType} SDK is already in your PATH`;
export const addedToPathPrompt = (sdkType: SdkTypeString) => `The ${sdkType} SDK was added to your PATH`;
export const addSdkToPathPrompt = (sdkType: SdkTypeString) => `Do you want to add the ${sdkType} SDK to PATH so it's accessible in external terminals?`;
export const unableToAddToPathPrompt = (sdkType: SdkTypeString) => `Unable to add the ${sdkType} SDK to PATH automatically. Show instructions to add manually?`;
export const openInstructionsAction = "Open Instructions";
export const copySdkPathToClipboardAction = "Copy SDK path to Clipboard";
export const addSdkToPathAction = "Add SDK to PATH";
export const addToPathInstructionsUrl = isWin
	? "https://flutter.dev/to/update-windows-path"
	: isMac
		? "https://flutter.dev/to/update-macos-path"
		: isLinux && !isChromeOS
			? "https://flutter.dev/to/update-linux-path"
			: undefined;

export const modifyingFilesOutsideWorkspaceInfoUrl = "https://dartcode.org/docs/modifying-files-outside-workspace/";
export const initializingFlutterMessage = "Initializing the Flutter SDK. This may take a few minutes.";
export const cloningFlutterMessage = "Downloading the Flutter SDK. This may take a few minutes.";


// Seconds.
export const fiveSecondsInMs = 1000 * 5;
export const tenSecondsInMs = 1000 * 10;
export const twentySecondsInMs = 1000 * 20;
export const thirtySecondsInMs = 1000 * 30;

export const fiveMinutesInMs = 1000 * 60 * 5;
export const tenMinutesInMs = 1000 * 60 * 10;

// Hours.
export const twoHoursInMs = 1000 * 60 * 60 * 2;
const twentyHoursInMs = 1000 * 60 * 60 * 20;
const fortyHoursInMs = 1000 * 60 * 60 * 40;

// Duration for not showing a prompt that has been shown before.
export const noRepeatPromptThreshold = twentyHoursInMs;
export const longRepeatPromptThreshold = fortyHoursInMs;

export const pleaseReportBug = "Please raise a bug against the Dart extension for VS Code.";

export const projectSearchProgressText = "Searching for projects...";
// Search for 2s before showing progress notification.
export const projectSearchProgressNotificationDelayInMs = 2000;
export const projectSearchCacheTimeInMs = fiveMinutesInMs;

export const DART_CREATE_PROJECT_TRIGGER_FILE = "dart.create";
export const FLUTTER_CREATE_PROJECT_TRIGGER_FILE = "flutter.create";
export const flutterCreateAvailablePlatforms = ["android", "ios", "linux", "macos", "windows", "web"];
export const flutterCreateTemplatesSupportingPlatforms = ["app", "plugin", "plugin_ffi", "skeleton"];


export const showErrorsAction = "Show Errors";
export const runAnywayAction = "Run Anyway";

export const userPromptContextPrefix = "hasPrompted.";
export const installFlutterExtensionPromptKey = "install_flutter_extension_3";
export const useRecommendedSettingsPromptKey = "use_recommended_settings";
export const yesAction = "Yes";
export const noAction = "No";
export const noThanksAction = "No Thanks";
export const skipAction = "Skip";
export const iUnderstandAction = "I Understand";
export const showRecommendedSettingsAction = "Show Recommended Settings";
export const recommendedSettingsUrl = "https://dartcode.org/docs/recommended-settings/";
export const openSettingsAction = "Open Settings File";
export const tryAgainAction = "Try Again";
export const vmServiceListeningBannerPattern = new RegExp("(?:Observatory|Dart VM [Ss]ervice) .* (?:listening on|available at:) (http:.+)");

export const sdkDeprecationInformationUrl = "https://dartcode.org/sdk-version-compatibility/";

/// Constants used in reporting of where commands are executed from.
///
/// Used in DevTools querystring, so do not change.
export abstract class CommandSource {
	static commandPalette = "command";
	static dtdServiceRequest = "dtdServiceRequest";
	static sidebarContent = "sidebarContent";
	static sidebarTitle = "sidebarToolbar";
	static touchbar = "touchbar"; // MacOS touchbar button
	static launchConfiguration = "launchConfiguration"; // Configured explicitly in launch configuration
	static onDebugAutomatic = "onDebugAutomatic"; // Configured to always run on debug session start
	static onDebugPrompt = "onDebugPrompt"; // Responded to prompt when running a debug session
	static languageStatus = "languageStatus"; // Launched from the language status popout
	static onSidebarShown = "onSidebarShown"; // Showed this page specifically in the sidebar.
}

export const validMethodNameRegex = new RegExp("^[a-zA-Z_][a-zA-Z0-9_]*$");
export const validClassNameRegex = validMethodNameRegex;

// This isn't included in [devToolsPages] because we only use it as a default.
export const devToolsHomePage = { id: "home", commandSuffix: "Home", title: "DevTools Home", requiredDartSdkVersion: "3.3.0-0" };
export const widgetInspectorPage: DevToolsPage = { id: "inspector", commandSuffix: "Inspector", title: "Widget Inspector", requiresFlutter: true };
export const cpuProfilerPage: DevToolsPage = { id: "cpu-profiler", commandSuffix: "CpuProfiler", title: "CPU Profiler" };
export const performancePage: DevToolsPage = {
	commandSuffix: "Performance",
	id: "performance",
	requiresFlutter: true,
	routeId: (flutterVersion) => !flutterVersion || versionIsAtLeast(flutterVersion, "2.3.1" /* 2.3.0-16.0? */) ? "performance" : "legacy-performance",
	title: "Performance",
};
export const devToolsPages: DevToolsPage[] = [
	widgetInspectorPage,
	cpuProfilerPage,
	{ id: "memory", commandSuffix: "Memory", title: "Memory" },
	performancePage,
	{ id: "network", commandSuffix: "Network", title: "Network" },
	{ id: "logging", commandSuffix: "Logging", title: "Logging" },
	{ id: "deep-links", commandSuffix: "DeepLinks", title: "Deep Links", requiresFlutter: true, requiredDartSdkVersion: "3.3.0-277", isStaticTool: true },
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

	// Allows pressing <TAB> to complete snippets such as `for` even when the
	// completion list is not visible.
	"editor.tabCompletion": "onlySnippets",

	// By default, VS Code will populate code completion with words found in the
	// matching documents when a language service does not provide its own completions.
	// This results in code completion suggesting words when editing comments and
	// strings. This setting will prevent that.
	"editor.wordBasedSuggestions": "off",
};

export const defaultLaunchJson = JSON.stringify(
	{
		configurations: [
			{
				name: "Dart & Flutter",
				request: "launch",
				type: "dart",
			},
		],
		version: "0.2.0",
	},
	undefined, "\t"
);

// This indicates that a version is the latest possible, used for Bazel workspaces.
export const MAX_VERSION = "999.999.999";

// This indicates the Flutter version file was missing and we are also assuming the highest.
export const MISSING_VERSION_FILE_VERSION = "999.999.888";
