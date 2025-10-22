import * as fs from "fs";
import * as https from "https";
import { minimatch } from "minimatch";
import * as os from "os";
import * as path from "path";
import { commands, Uri, window, workspace, WorkspaceFolder } from "vscode";
import { ExtensionRestartReason, showLogAction } from "../shared/constants";
import { BasicDebugConfiguration } from "../shared/debug/interfaces";
import { Logger, WorkspaceConfig } from "../shared/interfaces";
import { filenameSafe } from "../shared/utils";
import { fsPath, getRandomInt, hasPubspec, isFlutterProjectFolder } from "../shared/utils/fs";
import { isDartWorkspaceFolder } from "../shared/vscode/utils";
import { config } from "./config";
import { ringLog } from "./extension";
import { locateBestProjectRoot } from "./project";

function isFlutterWorkspaceFolder(folder?: WorkspaceFolder): boolean {
	return !!(folder && isDartWorkspaceFolder(folder) && isFlutterProjectFolder(fsPath(folder.uri)));
}

export function isInsideFlutterProject(uri?: Uri): boolean {
	if (!uri)
		return false;

	const projectRoot = locateBestProjectRoot(fsPath(uri));
	if (projectRoot)
		return isFlutterProjectFolder(projectRoot);
	else
		return isFlutterWorkspaceFolder(workspace.getWorkspaceFolder(uri));
}

export function isPathInsideFlutterProject(path: string): boolean {
	const projectRoot = locateBestProjectRoot(path);
	if (!projectRoot)
		return false;

	return isFlutterProjectFolder(projectRoot);
}

export function insertSessionName(args: { name: string }, logPath: string | undefined) {
	return logPath
		? logPath.replace(/\${name}/ig, filenameSafe(args.name || "unnamed-session"))
		: logPath;
}

export function insertWorkspaceName<T extends string | undefined>(p: T): string | (undefined extends T ? undefined : never) {
	if (typeof p !== "string")
		return undefined as (undefined extends T ? undefined : never);

	return p.replace(/\${workspaceName}/ig, filenameSafe(workspace.name ?? "unnamed-workspace"));
}

export function isAnalyzable(file: { uri: Uri, isUntitled?: boolean, languageId?: string }): boolean {
	if (file.isUntitled || !fsPath(file.uri) || file.uri.scheme !== "file")
		return false;

	const analyzableLanguages = ["dart", "html"];
	const analyzableFilenames = [".analysis_options", "analysis_options.yaml", "pubspec.yaml"];
	// We have to include dart/html extensions as this function may be called without a language ID
	// (for example when triggered by a file system watcher).
	const analyzableFileExtensions = ["dart", "htm", "html"].concat(config.additionalAnalyzerFileExtensions);

	const extName = path.extname(fsPath(file.uri));
	const extension = extName ? extName.substr(1) : undefined;

	return (file.languageId && analyzableLanguages.includes(file.languageId))
		|| analyzableFilenames.includes(path.basename(fsPath(file.uri)))
		|| (extension !== undefined && analyzableFileExtensions.includes(extension));
}

export function shouldHotReloadFor(file: { uri: Uri, isUntitled?: boolean, languageId?: string }): boolean {
	if (file.isUntitled || file.uri.scheme !== "file")
		return false;

	const filePath = fsPath(file.uri);
	const extension = path.extname(filePath).substr(1);

	const reloadableFileExtensions = ["dart", "htm", "html", "css", "frag"];
	if (reloadableFileExtensions.includes(extension))
		return true;

	const resourceConf = config.for(file.uri);
	return !!resourceConf.hotReloadPatterns.find((p) => minimatch(filePath, p, { dot: true }));
}

export function isAnalyzableAndInWorkspace(file: { uri: Uri, isUntitled?: boolean, languageId?: string }): boolean {
	return isAnalyzable(file) && isWithinWorkspace(fsPath(file.uri));
}

export function isWithinWorkspace(file: string) {
	return !!workspace.getWorkspaceFolder(Uri.file(file));
}

export function isTestFileOrFolder(path: string | undefined): boolean {
	return !!path && (isTestFile(path) || isTestFolder(path));
}

export function isTestFile(file: string): boolean {
	// To be a test, you must be _test.dart AND inside a test folder (unless allowTestsOutsideTestFolder).
	// https://github.com/Dart-Code/Dart-Code/issues/1165
	// https://github.com/Dart-Code/Dart-Code/issues/2021
	// https://github.com/Dart-Code/Dart-Code/issues/2034
	return !!file && isDartFile(file)
		&& (
			isInsideFolderNamed(file, "test")
			|| isInsideFolderNamed(file, "integration_test")
			|| isInsideFolderNamed(file, "test_driver")
			|| config.allowTestsOutsideTestFolder
		)
		&& file.toLowerCase().endsWith("_test.dart");
}

// Similar to isTestFile, but requires that the file is _test.dart because it will be used as
// an entry point for pub test running.
export function isRunnableTestFile(file: string): boolean {
	return !!file && isDartFile(file) && file.toLowerCase().endsWith("_test.dart");
}

export function isTestFolder(path: string | undefined): boolean {
	return !!path
		&& (
			isInsideFolderNamed(path, "test")
			|| isInsideFolderNamed(path, "integration_test")
		) && fs.existsSync(path)
		&& fs.statSync(path).isDirectory();
}

export function projectCanUsePackageTest(folder: string, config: WorkspaceConfig): boolean {
	// Handle explicit flags.
	if (config.supportsPackageTest === true)
		return true;
	else if (config.supportsPackageTest === false)
		return false;

	return hasPubspec(folder);
}

export function isDartFile(file: string): boolean {
	return !!file && path.extname(file.toLowerCase()) === ".dart" && fs.existsSync(file) && fs.statSync(file).isFile();
}

export function isInsideFolderNamed(file: string | undefined, folderName: string): boolean {
	if (!file)
		return false;

	const ws = workspace.getWorkspaceFolder(Uri.file(file));

	if (!ws)
		return false;

	const relPath = path.relative(fsPath(ws.uri).toLowerCase(), file.toLowerCase());
	const segments = relPath.split(path.sep);

	return segments.includes(folderName.toLowerCase());
}

export function hasTestFilter(args: string[]) {
	return args.includes("--name") || args.includes("--pname");
}

/// Ensures a debug config always has a unique ID we can use to match things up.
///
/// Although VS Code assigns an ID, we cannot get at it until after the debug session starts
/// which might be after we recieve some events (since VS Code fires its event late - after all
/// initialisation has completed).
export function ensureDebugLaunchUniqueId(config: BasicDebugConfiguration): string {
	const conf = config as any;
	if (!conf.dartCodeDebugSessionID) {
		const dartCodeDebugSessionID = `session-${getRandomInt(0x10000, 0x100000).toString(16)}`;
		conf.dartCodeDebugSessionID = dartCodeDebugSessionID;
	}
	return conf.dartCodeDebugSessionID as string;
}

export function isValidEntryFile(file: string | undefined) {
	if (!file || !isDartFile(file))
		return false;

	// When in a no-folder workspace, all Dart files are considered runnable.
	if (!workspace.workspaceFolders?.length)
		return true;

	return isTestFile(file)
		|| isInsideFolderNamed(file, "bin") || isInsideFolderNamed(file, "tool") || isInsideFolderNamed(file, "test_driver")
		|| file.endsWith(`lib${path.sep}main.dart`);
}

export function getLatestSdkVersion(): Promise<string> {
	return new Promise<string>((resolve, reject) => {
		const options: https.RequestOptions = {
			hostname: "storage.googleapis.com",
			method: "GET",
			path: "/dart-archive/channels/stable/release/latest/VERSION",
			port: 443,
		};

		const req = https.request(options, (resp) => {
			if (!resp?.statusCode || resp.statusCode < 200 || resp.statusCode > 300) {
				reject({ message: `Failed to get Dart SDK Version ${resp?.statusCode}: ${resp?.statusMessage}` });
			} else {
				resp.on("data", (d: Buffer | string) => {
					try {
						const latestVersion = JSON.parse(d.toString()).version as string;
						resolve(latestVersion);
					} catch {
						reject({ message: `Failed to parse latest Dart SDK Version from JSON: ${d.toString()}` });
					}
				});
			}
		});
		req.end();
	});
}

export async function promptToReloadExtension(logger: Logger, { prompt, buttonText, offerLog, specificLog, useError }: { prompt?: string; buttonText?: string; offerLog?: boolean; specificLog?: string; useError?: boolean; } = {}): Promise<void> {
	const restartAction = buttonText || "Reload";
	const actions = offerLog ? [restartAction, showLogAction] : [restartAction];

	logger.warn(`Prompting to reload: (${prompt}) (actions: ${actions.join(", ")})`);

	const ringLogContents = ringLog.toString();
	let showPromptAgain = true;
	const tempLogPath = path.join(os.tmpdir(), `log-${getRandomInt(0x1000, 0x10000).toString(16)}.txt`);
	while (showPromptAgain) {
		showPromptAgain = false;
		const show = useError ? window.showErrorMessage : window.showInformationMessage;
		const chosenAction = prompt && await show(prompt, ...actions);
		if (chosenAction === showLogAction) {
			showPromptAgain = true;
			if (specificLog && fs.existsSync(specificLog))
				void workspace.openTextDocument(specificLog).then(window.showTextDocument);
			else
				void openLogContents(undefined, ringLogContents, tempLogPath);
		} else if (!prompt || chosenAction === restartAction) {
			void commands.executeCommand("_dart.reloadExtension", ExtensionRestartReason.UserPrompt);
		}
	}
}

const shouldLogTimings = false;
const start = process.hrtime.bigint();
let last = start;
function pad(str: string, length: number) {
	while (str.length < length)
		str = "0" + str;
	return str;
}
export const logTime = (taskFinished?: string) => {
	if (!shouldLogTimings)
		return;
	const end = process.hrtime.bigint();
	console.log(`${pad((end - last).toString(), 15)} ${taskFinished ? "<== " + taskFinished : ""}`);
	last = end;
};

export async function openLogContents(logType = `txt`, logContents: string, tempPath?: string) {
	if (!tempPath)
		tempPath = path.join(os.tmpdir(), `log-${getRandomInt(0x1000, 0x10000).toString(16)}.${logType}`);
	fs.writeFileSync(tempPath, logContents);
	await workspace.openTextDocument(tempPath).then(window.showTextDocument);
}

/// Gets all excluded folders (full absolute paths) for a given workspace
/// folder based on config.
export function getExcludedFolders(f: WorkspaceFolder | undefined): string[] {
	if (!f)
		return [];

	const excludedForWorkspace = config.for(f.uri).analysisExcludedFolders;
	if (!excludedForWorkspace || !Array.isArray(excludedForWorkspace))
		return [];

	const workspacePath = fsPath(f.uri);
	return excludedForWorkspace.map((folder) => {
		// Handle both relative and absolute paths.
		if (!path.isAbsolute(folder))
			folder = path.join(workspacePath, folder);
		return folder;
	});
}
