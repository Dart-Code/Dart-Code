import * as fs from "fs";
import * as https from "https";
import * as os from "os";
import * as path from "path";
import { commands, Uri, window, workspace, WorkspaceFolder } from "vscode";
import { showLogAction } from "../shared/constants";
import { BasicDebugConfiguration } from "../shared/debug/interfaces";
import { WorkspaceConfig } from "../shared/interfaces";
import { fsPath, getRandomInt, hasPubspec, isFlutterProjectFolder, isWithinPath, mkDirRecursive } from "../shared/utils/fs";
import { isDartWorkspaceFolder } from "../shared/vscode/utils";
import { config } from "./config";
import { ringLog } from "./extension";
import { locateBestProjectRoot } from "./project";

export function isFlutterWorkspaceFolder(folder?: WorkspaceFolder): boolean {
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

export function resolvePaths<T extends string | undefined>(p: T): string | (undefined extends T ? undefined : never) {
	if (typeof p !== "string")
		return undefined as (undefined extends T ? undefined : never);

	if (p.startsWith("~/"))
		return path.join(os.homedir(), p.substr(2));
	if (!path.isAbsolute(p) && workspace.workspaceFolders && workspace.workspaceFolders.length)
		return path.join(fsPath(workspace.workspaceFolders[0].uri), p);
	return p;
}

/// Shortens a path to use ~ if it's inside the home directory.
export function homeRelativePath(p?: string) {
	if (!p) return undefined;
	const homedir = os.homedir();
	if (isWithinPath(p, homedir))
		return path.join("~", path.relative(homedir, p));
	return p;
}

export function createFolderForFile(file?: string): string | undefined {
	try {
		if (!file || !path.isAbsolute(file))
			return undefined;

		const folder = path.dirname(file);
		if (!fs.existsSync(folder))
			mkDirRecursive(folder);

		return file;
	} catch {
		console.warn(`Ignoring invalid file path ${file}`);
		return undefined;
	}
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

	return (file.languageId && analyzableLanguages.indexOf(file.languageId) >= 0)
		|| analyzableFilenames.indexOf(path.basename(fsPath(file.uri))) >= 0
		|| (extension !== undefined && analyzableFileExtensions.includes(extension));
}

export function shouldHotReloadFor(file: { uri: Uri, isUntitled?: boolean, languageId?: string }): boolean {
	if (file.isUntitled || !fsPath(file.uri) || file.uri.scheme !== "file")
		return false;

	const reloadableFileExtensions = ["dart", "htm", "html", "css", "frag"];

	const extName = path.extname(fsPath(file.uri));
	const extension = extName ? extName.substr(1) : undefined;

	return extension !== undefined && reloadableFileExtensions.includes(extension);
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
	// To be a test, you must be _test.dart AND inside a test folder.
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

	return segments.indexOf(folderName.toLowerCase()) !== -1;
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
	return conf.dartCodeDebugSessionID;
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
			if (!resp || !resp.statusCode || resp.statusCode < 200 || resp.statusCode > 300) {
				reject({ message: `Failed to get Dart SDK Version ${resp && resp.statusCode}: ${resp && resp.statusMessage}` });
			} else {
				resp.on("data", (d: Buffer | string) => {
					try {
						const latestVersion = JSON.parse(d.toString()).version as string;
						resolve(latestVersion);
					} catch (e) {
						reject({ message: `Failed to parse latest Dart SDK Version from JSON: ${d.toString()}` });
					}
				});
			}
		});
		req.end();
	});
}

// Escapes a set of command line arguments so that the escaped string is suitable for passing as an argument
// to another shell command.
// Implementation is taken from https://github.com/xxorax/node-shell-escape
export function escapeShell(args: string[]) {
	const ret: string[] = [];
	args.forEach((arg) => {
		if (/[^A-Za-z0-9_\/:=-]/.test(arg)) {
			arg = "'" + arg.replace(/'/g, "'\\''") + "'";
			arg = arg.replace(/^(?:'')+/g, "") // unduplicate single-quote at the beginning
				.replace(/\\'''/g, "\\'"); // remove non-escaped single-quote if there are enclosed between 2 escaped
		}
		ret.push(arg);
	});
	return ret.join(" ");
}

export async function promptToReloadExtension(prompt?: string, buttonText?: string, offerLog?: boolean): Promise<void> {
	const restartAction = buttonText || "Reload";
	const actions = offerLog ? [restartAction, showLogAction] : [restartAction];
	const ringLogContents = ringLog.toString();
	let showPromptAgain = true;
	const tempLogPath = path.join(os.tmpdir(), `log-${getRandomInt(0x1000, 0x10000).toString(16)}.txt`);
	while (showPromptAgain) {
		showPromptAgain = false;
		const chosenAction = prompt && await window.showInformationMessage(prompt, ...actions);
		if (chosenAction === showLogAction) {
			showPromptAgain = true;
			void openLogContents(undefined, ringLogContents, tempLogPath);
		} else if (!prompt || chosenAction === restartAction) {
			void commands.executeCommand("_dart.reloadExtension");
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
