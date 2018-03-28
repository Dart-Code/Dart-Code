import * as child_process from "child_process";
import * as fs from "fs";
import * as https from "https";
import * as os from "os";
import * as path from "path";
import * as semver from "semver";
import {
	commands, env as vsEnv, MessageItem, Position, Range, TextDocument, Uri, window, workspace, WorkspaceFolder,
} from "vscode";
import * as as from "./analysis/analysis_server_types";
import { config } from "./config";
import { PackageMap } from "./debug/utils";

const isWin = /^win/.test(process.platform);
const dartExecutableName = isWin ? "dart.exe" : "dart";
const pubExecutableName = isWin ? "pub.bat" : "pub";
const flutterExecutableName = isWin ? "flutter.bat" : "flutter";
export const dartVMPath = "bin/" + dartExecutableName;
export const dartPubPath = "bin/" + pubExecutableName;
export const analyzerPath = "bin/snapshots/analysis_server.dart.snapshot";
export const flutterPath = "bin/" + flutterExecutableName;
export const extensionVersion = getExtensionVersion();
export const isDevExtension = checkIsDevExtension();
export const FLUTTER_CREATE_PROJECT_TRIGGER_FILE = "dart_code_flutter_create.dart";
export const DART_DOWNLOAD_URL = "https://www.dartlang.org/install";
export const FLUTTER_DOWNLOAD_URL = "https://flutter.io/setup/";

export function isFlutterWorkspaceFolder(folder: WorkspaceFolder): boolean {
	return isDartWorkspaceFolder(folder) && isFlutterProjectFolder(folder.uri.fsPath);
}

export function isFlutterProjectFolder(folder: string): boolean {
	return referencesFlutterSdk(folder);
}

function referencesFlutterSdk(folder: string): boolean {
	if (folder && fs.existsSync(path.join(folder, "pubspec.yaml"))) {
		const regex = new RegExp("sdk\\s*:\\s*flutter", "i");
		return regex.test(fs.readFileSync(path.join(folder, "pubspec.yaml")).toString());
	}
	return false;
}

export function searchPaths(paths: string[], filter: (s: string) => boolean, executableName: string): string {
	let sdkPath =
		paths
			.filter((p) => p)
			.map(resolveHomePath)
			.map((p) => path.basename(p) !== "bin" ? path.join(p, "bin") : p) // Ensure /bin on end.
			.find(filter);

	// In order to handle symlinks on the binary (not folder), we need to add the executableName and then realpath.
	sdkPath = sdkPath && fs.realpathSync(path.join(sdkPath, executableName));

	// Then we need to take the executable name and /bin back off
	sdkPath = sdkPath && path.dirname(path.dirname(sdkPath));

	return sdkPath;
}

export function findSdks(): Sdks {
	const folders = getDartWorkspaceFolders()
		.map((w) => w.uri.fsPath);
	const pathOverride = (process.env.DART_PATH_OVERRIDE as string) || "";
	const normalPath = (process.env.PATH as string) || "";
	const paths = (pathOverride + path.delimiter + normalPath).split(path.delimiter);
	const platformName = isWin ? "win" : process.platform === "darwin" ? "mac" : "linux";

	let fuchsiaRoot: string;
	let flutterProject: string;
	// Keep track of whether we have Fuchsia projects that are not "vanilla Flutter" because
	// if not we will set project type to Flutter to allow daemon to run (and debugging support).
	let hasFuchsiaProjectThatIsNotVanillaFlutter: boolean;
	folders.forEach((folder) => {
		fuchsiaRoot = fuchsiaRoot || findFuchsiaRoot(folder);
		flutterProject = flutterProject
			|| (referencesFlutterSdk(folder) ? folder : null)
			|| (fs.existsSync(path.join(folder, FLUTTER_CREATE_PROJECT_TRIGGER_FILE)) ? folder : null)
			// Special case to detect the Flutter repo root, so we always consider it a Flutter project and will use the local SDK
			|| (fs.existsSync(path.join(folder, "bin/flutter")) && fs.existsSync(path.join(folder, "bin/cache/dart-sdk")) ? folder : null);
		hasFuchsiaProjectThatIsNotVanillaFlutter = hasFuchsiaProjectThatIsNotVanillaFlutter || !referencesFlutterSdk(folder);
	});

	const flutterSdkSearchPaths = [
		config.flutterSdkPath,
		fuchsiaRoot && path.join(fuchsiaRoot, "lib/flutter"),
		fuchsiaRoot && path.join(fuchsiaRoot, "third_party/dart-pkg/git/flutter"),
		flutterProject,
		flutterProject && extractFlutterSdkPathFromPackagesFile(path.join(flutterProject, ".packages")),
		process.env.FLUTTER_ROOT,
	].concat(paths);

	const flutterSdkPath = searchPaths(flutterSdkSearchPaths, hasFlutterExecutable, flutterExecutableName);

	const dartSdkSearchPaths = [
		config.sdkPath,
		fuchsiaRoot && path.join(fuchsiaRoot, "third_party/dart/tools/sdks", platformName, "dart-sdk"),
		fuchsiaRoot && path.join(fuchsiaRoot, "dart/tools/sdks", platformName, "dart-sdk"),
		flutterProject && flutterSdkPath && path.join(flutterSdkPath, "bin/cache/dart-sdk"),
	].concat(paths)
		// The above array only has the Flutter SDK	in the search path if we KNOW it's a flutter
		// project, however this doesn't cover the activating-to-run-flutter.createProject so
		// we need to always look in the flutter SDK, but only AFTER the users PATH so that
		// we don't prioritise it over any real Dart versions.
		.concat([flutterSdkPath && path.join(flutterSdkPath, "bin/cache/dart-sdk")]);

	const dartSdkPath =
		searchPaths(dartSdkSearchPaths, hasDartExecutable, dartExecutableName);

	return {
		dart: dartSdkPath,
		flutter: flutterSdkPath,
		fuchsia: fuchsiaRoot,
		projectType: fuchsiaRoot && hasFuchsiaProjectThatIsNotVanillaFlutter
			? ProjectType.Fuchsia
			: (flutterProject ? ProjectType.Flutter : ProjectType.Dart),
	};
}

function extractFlutterSdkPathFromPackagesFile(file: string): string {
	if (!fs.existsSync(file))
		return null;

	let packagePath = new PackageMap(file).getPackagePath("flutter");

	if (!packagePath)
		return null;

	// Set windows slashes to / while manipulating.
	if (isWin) {
		packagePath = packagePath.replace(/\\/g, "/");
	}

	// Trim suffix we don't need.
	const pathSuffix = "/packages/flutter/lib/";
	if (packagePath.endsWith(pathSuffix)) {
		packagePath = packagePath.substr(0, packagePath.length - pathSuffix.length);
	}

	// Make sure ends with a slash.
	if (!packagePath.endsWith("/"))
		packagePath = packagePath + "/";

	// Append bin if required.
	if (!packagePath.endsWith("/bin/")) {
		packagePath = packagePath + "bin/";
	}

	// Set windows paths back.
	if (isWin) {
		packagePath = packagePath.replace(/\//g, "\\");
		if (packagePath[0] === "\\")
			packagePath = packagePath.substring(1);
	}

	return packagePath;
}

function findFuchsiaRoot(folder: string): string {
	if (folder) {
		// Walk up the directories from the workspace root, and see if there
		// exists a directory which has ".jiri_root" directory as a child.
		// If such directory is found, that is our fuchsia root.
		let dir = folder;
		while (dir != null) {
			try {
				if (fs.statSync(path.join(dir, ".jiri_root")).isDirectory()) {
					return dir;
				}
			} catch { }

			const parentDir = path.dirname(dir);
			if (dir === parentDir)
				break;

			dir = parentDir;
		}
	}

	return null;
}

export function getDartWorkspaceFolders(): WorkspaceFolder[] {
	if (!workspace.workspaceFolders)
		return [];
	return workspace.workspaceFolders.filter(isDartWorkspaceFolder);
}

export function isDartWorkspaceFolder(folder: WorkspaceFolder): boolean {
	if (!folder || folder.uri.scheme !== "file")
		return false;

	// TODO: Filter to only Dart projects.
	return true;
}

export const hasDartExecutable = (pathToTest: string) => hasExecutable(pathToTest, dartExecutableName);
export const hasFlutterExecutable = (pathToTest: string) => hasExecutable(pathToTest, flutterExecutableName);

function hasExecutable(pathToTest: string, executableName: string): boolean {
	return fs.existsSync(path.join(pathToTest, executableName));
}

export function resolveHomePath(p: string) {
	if (p == null) return null;
	if (p.startsWith("~/"))
		return path.join(os.homedir(), p.substr(2));
	return p;
}

export interface Location {
	startLine: number;
	startColumn: number;
	length: number;
}

export function toPosition(location: Location): Position {
	return new Position(location.startLine - 1, location.startColumn - 1);
}

export function toRange(location: Location): Range {
	const startPos = toPosition(location);
	return new Range(startPos, startPos.translate(0, location.length));
}

export function getSdkVersion(sdkRoot: string): string {
	if (!sdkRoot)
		return null;
	try {
		return fs
			.readFileSync(path.join(sdkRoot, "version"), "utf8")
			.trim()
			.split("\n")
			.filter((l) => l)
			.filter((l) => l.trim().substr(0, 1) !== "#")
			.join("\n")
			.trim();
	} catch (e) {
		return null;
	}
}

export function isAnalyzable(document: TextDocument): boolean {
	if (document.isUntitled || !document.fileName)
		return false;

	const analyzableLanguages = ["dart", "html"];
	const analyzableFilenames = [".analysis_options", "analysis_options.yaml"];

	return analyzableLanguages.indexOf(document.languageId) >= 0
		|| analyzableFilenames.indexOf(path.basename(document.fileName)) >= 0;
}

export function isAnalyzableAndInWorkspace(document: TextDocument): boolean {
	if (document.isUntitled || !document.fileName)
		return false;

	return isAnalyzable(document) && isWithinWorkspace(document.fileName);
}

export function isWithinWorkspace(file: string) {
	// TODO: Is this fixed?
	// asRelativePath returns the input if it's outside of the rootPath.
	// Edit: Doesn't actually work properly:
	//   https://github.com/Microsoft/vscode/issues/10446
	// return workspace.asRelativePath(document.fileName) != document.fileName;
	// Edit: Still doesn't work properly!
	//   https://github.com/Microsoft/vscode/issues/33709

	return !!workspace.getWorkspaceFolder(Uri.file(file));
}

export function isTestFile(file: string): boolean {
	return isInsideFolderNamed(file, "test");
}

export function isInsideFolderNamed(file: string, folderName: string): boolean {
	if (!file)
		return false;

	if (!file.toLowerCase().endsWith(".dart"))
		return false;

	const ws = workspace.getWorkspaceFolder(Uri.file(file));

	if (!ws)
		return false;

	const relPath = path.sep + path.relative(ws.uri.fsPath, file);

	// We only want to check the relative path from the workspace root so that if the whole project is inside a
	// test (etc.) folder (for ex. Dart Code's own tests) we don't falsely assume it's an end user test.
	return relPath.toLowerCase().indexOf(`${path.sep}${folderName}${path.sep}`) !== -1;
}

function getExtensionVersion(): string {
	const packageJson = require("../../package.json");
	return packageJson.version;
}

export function versionIsAtLeast(inputVersion: string, requiredVersion: string): boolean {
	return semver.gte(inputVersion, requiredVersion);
}

function checkIsDevExtension() {
	return extensionVersion.endsWith("-dev") || vsEnv.machineId === "someValue.machineId";
}

export function isStableSdk(sdkVersion: string): boolean {
	// We'll consider empty versions as dev; stable versions will likely always
	// be shipped with valid version files.
	return !!(sdkVersion && !semver.prerelease(sdkVersion));
}

export function logError(error: { message: string }): void {
	if (isDevExtension)
		window.showErrorMessage("DEBUG: " + error.message);
	console.error(error.message);
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
			if (resp.statusCode < 200 || resp.statusCode > 300) {
				reject({ message: `Failed to get Dart SDK Version ${resp.statusCode}: ${resp.statusMessage}` });
			} else {
				resp.on("data", (d) => {
					resolve(JSON.parse(d.toString()).version);
				});
			}
		});
		req.end();
	});
}

export function escapeRegExp(input: string) {
	// https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Regular_Expressions
	return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); // $& means the whole matched string
}

export function openInBrowser(url: string) {
	commands.executeCommand("vscode.open", Uri.parse(url));
}

export class Sdks {
	public dart: string;
	public flutter: string;
	public fuchsia: string;
	public projectType: ProjectType;
}

export enum ProjectType {
	Dart,
	Flutter,
	Fuchsia,
}

export function showFluttersDartSdkActivationFailure() {
	reloadExtension("Could not find Dart in your Flutter SDK. " +
		"Please run 'flutter doctor' in the terminal then reload the project once all issues are resolved.",
		"Reload",
	);
}
export function showFlutterActivationFailure(commandToReRun: string = null) {
	showSdkActivationFailure(
		"Flutter",
		(paths) => searchPaths(paths, hasFlutterExecutable, flutterExecutableName),
		FLUTTER_DOWNLOAD_URL,
		(p) => config.setGlobalFlutterSdkPath(p),
		commandToReRun,
	);
}
export function showDartActivationFailure() {
	showSdkActivationFailure(
		"Dart",
		(paths) => searchPaths(paths, hasDartExecutable, dartExecutableName),
		DART_DOWNLOAD_URL,
		(p) => config.setGlobalDartSdkPath(p),
	);
}

export async function showSdkActivationFailure(
	sdkType: string,
	search: (path: string[]) => string,
	downloadUrl: string,
	saveSdkPath: (path: string) => Thenable<void>,
	commandToReRun: string = null,
) {
	const locateAction = "Locate SDK";
	const downloadAction = "Download SDK";
	let displayMessage = `Could not find a ${sdkType} SDK. ` +
		`Please ensure ${sdkType.toLowerCase()} is installed and in your PATH (you may need to restart).`;
	while (true) {
		const selectedItem = await window.showErrorMessage(displayMessage,
			locateAction,
			downloadAction,
		);
		// TODO: Refactor/reformat/comment this code - it's messy and hard to understand!
		if (selectedItem === locateAction) {
			const selectedFolders =
				await window.showOpenDialog({ canSelectFolders: true, openLabel: `Set ${sdkType} SDK folder` });
			if (selectedFolders && selectedFolders.length > 0) {
				const matchingSdkFolder = search(selectedFolders.map((f) => f.fsPath));
				if (matchingSdkFolder) {
					await saveSdkPath(matchingSdkFolder);
					await reloadExtension();
					if (commandToReRun) {
						commands.executeCommand(commandToReRun);
					}
					break;
				} else {
					displayMessage = `That folder does not appear to be a ${sdkType} SDK.`;
				}
			}
		} else if (selectedItem === downloadAction) {
			openInBrowser(downloadUrl);
			break;
		} else {
			break;
		}
	}
}

export async function reloadExtension(prompt?: string, buttonText?: string) {
	const restartAction = buttonText || "Restart";
	if (!prompt || await window.showInformationMessage(prompt, restartAction) === restartAction) {
		commands.executeCommand("_dart.reloadExtension");
	}
}

export function safeSpawn(workingDirectory: string, binPath: string, args: string[], env?: any): child_process.ChildProcess {
	// Spawning processes on Windows with funny symbols in the path requires quoting. However if you quote an
	// executable with a space in its path and an argument also has a space, you have to then quote all of the
	// arguments too!
	// Tragic.
	// https://github.com/nodejs/node/issues/7367
	return child_process.spawn(`"${binPath}"`, args.map((a) => `"${a}"`), { cwd: workingDirectory, env, shell: true });
}

export function unique<T>(items: T[]): T[] {
	return Array.from(new Set(items));
}

const shouldLogTimings = false;
const start = process.hrtime();
let last = start;
function pad(str: string, length: number) {
	while (str.length < length)
		str = "0" + str;
	return str;
}
export const logTime = (taskFinished?: string) => {
	if (!shouldLogTimings)
		return;
	const diff = process.hrtime(start);
	console.log(`${pad((diff[0] - last[0]).toString(), 5)}.${pad((diff[1] - last[1]).toString(), 10)} ${taskFinished ? "<== " + taskFinished : ""}`);
	last = diff;
};
