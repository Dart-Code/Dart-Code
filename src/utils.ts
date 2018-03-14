import * as fs from "fs";
import * as https from "https";
import * as os from "os";
import * as path from "path";
import * as semver from "semver";
import {
	commands, env, MessageItem, Position, Range, TextDocument, Uri, window, workspace, WorkspaceFolder,
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
export const isDevelopment = checkIsDevelopment();
export const FLUTTER_CREATE_PROJECT_TRIGGER_FILE = "dart_code_flutter_create.dart";
export const DART_DOWNLOAD_URL = "https://www.dartlang.org/install";
export const FLUTTER_DOWNLOAD_URL = "https://flutter.io/setup/";

export function isFlutterProject(folder: WorkspaceFolder): boolean {
	return isDartWorkspaceFolder(folder) && referencesFlutterSdk(folder.uri.fsPath);
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
const hasFlutterExecutable = (pathToTest: string) => hasExecutable(pathToTest, flutterExecutableName);

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
		return fs.readFileSync(path.join(sdkRoot, "version"), "utf8").trim();
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

function getExtensionVersion(): string {
	const packageJson = require("../../package.json");
	return packageJson.version;
}

export function versionIsAtLeast(inputVersion: string, requiredVersion: string): boolean {
	return semver.gte(inputVersion, requiredVersion);
}

function checkIsDevelopment() {
	return extensionVersion.endsWith("-dev") || env.machineId === "someValue.machineId";
}

export function logError(error: { message: string }): void {
	if (isDevelopment)
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
	promptForReload("Could not find Dart in your Flutter SDK. " +
		"Please run 'flutter doctor' in the terminal then reload the project once all issues are resolved.",
	);
}
export function showFlutterActivationFailure(runningFlutterCommand: string = null) {
	showSdkActivationFailure(
		"Flutter",
		(paths) => searchPaths(paths, hasFlutterExecutable, flutterExecutableName),
		FLUTTER_DOWNLOAD_URL,
		(p) => config.setGlobalFlutterSdkPath(p),
		runningFlutterCommand
			? `Your SDK path has been saved. Please reload and then re-run the "${runningFlutterCommand}" command.`
			: null,
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
	saveSdkPath: (path: string) => void,
	reloadPrompt: string = null,
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
					saveSdkPath(matchingSdkFolder);
					if (reloadPrompt)
						promptForReload(reloadPrompt);
					else
						commands.executeCommand("workbench.action.reloadWindow");
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

export async function promptForReload(message: string) {
	const reloadAction = "Reload Window";
	if (await window.showInformationMessage(message, reloadAction) === reloadAction) {
		commands.executeCommand("workbench.action.reloadWindow");
	}
}
