import * as fs from "fs";

export const dartCodeExtensionIdentifier = "Dart-Code.dart-code";
export const flutterExtensionIdentifier = "Dart-Code.flutter";

export const isWin = /^win/.test(process.platform);
export const isMac = process.platform === "darwin";
export const isLinux = !isWin && !isMac;
export const isChromeOS = isLinux && fs.existsSync("/dev/.cros_milestone");
// Used for code checks and in Dart SDK urls so Chrome OS is considered Linux.
export const dartPlatformName = isWin ? "win" : isMac ? "mac" : "linux";
// Used for display (logs, analytics) so Chrome OS is its own.
export const platformDisplayName = isWin ? "win" : isMac ? "mac" : isChromeOS ? "chromeos" : "linux";
export const platformEol = isWin ? "\r\n" : "\n";

export const dartExecutableName = isWin ? "dart.exe" : "dart";
export const pubExecutableName = isWin ? "pub.bat" : "pub";
export const flutterExecutableName = isWin ? "flutter.bat" : "flutter";
export const androidStudioExecutableNames = isWin ? ["studio64.exe"] : ["studio.sh", "studio"];
export const dartVMPath = "bin/" + dartExecutableName;
export const pubPath = "bin/" + pubExecutableName;
export const pubSnapshotPath = "bin/snapshots/pub.dart.snapshot";
export const analyzerSnapshotPath = "bin/snapshots/analysis_server.dart.snapshot";
export const flutterPath = "bin/" + flutterExecutableName;
export const androidStudioPaths = androidStudioExecutableNames.map((s) => "bin/" + s);
export const DART_DOWNLOAD_URL = "https://dart.dev/get-dart";
export const FLUTTER_DOWNLOAD_URL = "https://flutter.io/setup/";

export const DART_TEST_SUITE_NODE_CONTEXT = "dart-code:testSuiteNode";
export const DART_TEST_GROUP_NODE_CONTEXT = "dart-code:testGroupNode";
export const DART_TEST_TEST_NODE_CONTEXT = "dart-code:testTestNode";

export const DART_DEP_PROJECT_NODE_CONTEXT = "dart-code:depProjectNode";
export const DART_DEP_PACKAGE_NODE_CONTEXT = "dart-code:depPackageNode";
export const DART_DEP_FOLDER_NODE_CONTEXT = "dart-code:depFolderNode";
export const DART_DEP_FILE_NODE_CONTEXT = "dart-code:depFileNode";

export const IS_RUNNING_LOCALLY_CONTEXT = "dart-code:isRunningLocally";

export const stopLoggingAction = "Stop Logging";
export const showLogAction = "Show Log";

export const restartReasonManual = "manual";
export const restartReasonSave = "save";

export const pubGlobalDocsUrl = "https://www.dartlang.org/tools/pub/cmd/pub-global";
export const stagehandInstallationInstructionsUrl = "https://github.com/dart-lang/stagehand#installation";

export const wantToTryDevToolsPrompt = "Dart DevTools (preview) includes additional tools for debugging and profiling Flutter apps, including a Widget Inspector. Try it?";
export const openDevToolsAction = "Open DevTools";
export const noThanksAction = "No Thanks";
export const doNotAskAgainAction = "Don't Ask Again";

export const flutterSurveyPromptWithAnalytics = "Help improve Flutter! Take our Q3 survey. By clicking on this link you agree to share feature usage along with the survey responses.";
export const flutterSurveyPromptWithoutAnalytics = "Help improve Flutter! Take our Q3 survey.";
export const takeSurveyAction = "Take Survey";

// Minutes.
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

// Chrome OS exposed ports: 8000, 8008, 8080, 8085, 8888, 9005, 3000, 4200, 5000
export const CHROME_OS_DEVTOOLS_PORT = 8080;
export const CHROME_OS_VM_SERVICE_PORT = 8085;

export const DART_STAGEHAND_PROJECT_TRIGGER_FILE = "dart.sh.create";
export const FLUTTER_STAGEHAND_PROJECT_TRIGGER_FILE = "flutter.sh.create";
export const FLUTTER_CREATE_PROJECT_TRIGGER_FILE = "flutter.create";

export const REFACTOR_FAILED_DOC_MODIFIED = "This refactor cannot be applied because the document has changed.";
export const REFACTOR_ANYWAY = "Refactor Anyway";

export const TRACK_WIDGET_CREATION_ENABLED = "dart-code:trackWidgetCreationEnabled";
export const HAS_LAST_DEBUG_CONFIG = "dart-code:hasLastDebugConfig";
export const showErrorsAction = "Show Errors";
export const debugAnywayAction = "Debug Anyway";

export const userPromptContextPrefix = "hasPrompted.";
export const installFlutterExtensionPromptKey = "install_flutter_extension_3";

export const observatoryListeningBannerPattern: RegExp = new RegExp("Observatory (?:listening on|.* is available at:) (http:.+)");
export const observatoryHttpLinkPattern: RegExp = new RegExp("(http://[\\d\\.:]+/)");
