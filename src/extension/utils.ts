import * as fs from "fs";
import * as https from "https";
import * as os from "os";
import * as path from "path";
import { commands, Uri, window, workspace, WorkspaceFolder } from "vscode";
import { showLogAction } from "../shared/constants";
import { Logger } from "../shared/interfaces";
import { fsPath, getRandomInt, hasPubspec, isWithinPath, mkDirRecursive } from "../shared/utils/fs";
import { isDartWorkspaceFolder } from "../shared/vscode/utils";
import { config } from "./config";
import { ringLog } from "./extension";
import { locateBestProjectRoot } from "./project";
import { referencesFlutterSdk } from "./sdk/utils";

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

export function isFlutterProjectFolder(folder?: string): boolean {
	return referencesFlutterSdk(folder);
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

export function getSdkVersion(logger: Logger, { sdkRoot, versionFile }: { sdkRoot?: string, versionFile?: string }): string | undefined {
	if (!sdkRoot && !versionFile)
		return undefined;
	if (!versionFile)
		versionFile = path.join(sdkRoot!, "version");
	if (!fs.existsSync(versionFile))
		return undefined;
	try {
		return fs
			.readFileSync(versionFile, "utf8")
			.trim()
			.split("\n")
			.filter((l) => l)
			.filter((l) => l.trim().substr(0, 1) !== "#")
			.join("\n")
			.trim();
	} catch (e) {
		logger.error(e);
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

	const reloadableFileExtensions = ["dart", "htm", "html", "css"];

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

export function isTestFileOrFolder(path: string): boolean {
	return !!path && (isTestFile(path) || isTestFolder(path));
}

export function isTestFile(file: string): boolean {
	// To be a test, you must be _test.dart AND inside a test folder.
	// https://github.com/Dart-Code/Dart-Code/issues/1165
	// https://github.com/Dart-Code/Dart-Code/issues/2021
	// https://github.com/Dart-Code/Dart-Code/issues/2034
	return !!file && isDartFile(file)
		&& (isInsideFolderNamed(file, "test") || config.allowTestsOutsideTestFolder)
		&& file.toLowerCase().endsWith("_test.dart");
}

// Similar to isTestFile, but requires that the file is _test.dart because it will be used as
// an entry point for pub test running.
export function isPubRunnableTestFile(file: string): boolean {
	return !!file && isDartFile(file) && file.toLowerCase().endsWith("_test.dart");
}

export function isTestFolder(path: string): boolean {
	return !!path && isInsideFolderNamed(path, "test") && fs.existsSync(path) && fs.statSync(path).isDirectory();
}

export function checkProjectSupportsPubRunTest(folder: string, isDartSdkRepo: boolean): boolean {
	return hasPubspec(folder) && !isDartSdkRepo;
}

export function isDartFile(file: string): boolean {
	return !!file && path.extname(file.toLowerCase()) === ".dart" && fs.existsSync(file) && fs.statSync(file).isFile();
}

export function isInsideFolderNamed(file: string, folderName: string): boolean {
	if (!file)
		return false;

	const ws = workspace.getWorkspaceFolder(Uri.file(file));

	if (!ws)
		return false;

	const relPath = path.relative(fsPath(ws.uri), file).toLowerCase();
	const segments = relPath.split(path.sep);

	return segments.indexOf(folderName.toLowerCase()) !== -1;
}

export function getLatestSdkVersion(): PromiseLike<string> {
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
				resp.on("data", (d) => {
					resolve(JSON.parse(d.toString()).version);
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

export async function promptToReloadExtension(prompt?: string, buttonText?: string, offerLog?: boolean) {
	const restartAction = buttonText || "Restart";
	const actions = offerLog ? [restartAction, showLogAction] : [restartAction];
	const ringLogContents = ringLog.toString();
	const chosenAction = prompt && await window.showInformationMessage(prompt, ...actions);
	if (chosenAction === showLogAction) {
		openLogContents(undefined, ringLogContents);
	} else if (!prompt || chosenAction === restartAction) {
		commands.executeCommand("_dart.reloadExtension");
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

export function openLogContents(logType = `txt`, logContents: string) {
	const tempPath = path.join(os.tmpdir(), `log-${getRandomInt(0x1000, 0x10000).toString(16)}.${logType}`);
	fs.writeFileSync(tempPath, logContents);
	workspace.openTextDocument(tempPath).then(window.showTextDocument);
}
