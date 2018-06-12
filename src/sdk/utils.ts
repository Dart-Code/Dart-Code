import * as fs from "fs";
import * as path from "path";
import { ExtensionContext, commands, window } from "vscode";
import { Analytics } from "../analytics";
import { config } from "../config";
import { PackageMap } from "../debug/package_map";
import { FLUTTER_CREATE_PROJECT_TRIGGER_FILE, ProjectType, Sdks, fsPath, getDartWorkspaceFolders, openInBrowser, reloadExtension, resolvePaths } from "../utils";

const isWin = /^win/.test(process.platform);
const dartExecutableName = isWin ? "dart.exe" : "dart";
const pubExecutableName = isWin ? "pub.bat" : "pub";
const flutterExecutableName = isWin ? "flutter.bat" : "flutter";
export const dartVMPath = "bin/" + dartExecutableName;
export const dartPubPath = "bin/" + pubExecutableName;
export const analyzerSnapshotPath = "bin/snapshots/analysis_server.dart.snapshot";
export const flutterPath = "bin/" + flutterExecutableName;
export const DART_DOWNLOAD_URL = "https://www.dartlang.org/install";
export const FLUTTER_DOWNLOAD_URL = "https://flutter.io/setup/";

export function handleMissingSdks(context: ExtensionContext, analytics: Analytics, sdks: Sdks) {
	// HACK: In order to provide a more useful message if the user was trying to fun flutter.createProject
	// we need to hook the command and force the project type to Flutter to get the correct error message.
	// This can be reverted and improved if Code adds support for providing activation context:
	//     https://github.com/Microsoft/vscode/issues/44711
	let commandToReRun: string;
	context.subscriptions.push(commands.registerCommand("flutter.createProject", (_) => {
		sdks.projectType = ProjectType.Flutter;
		commandToReRun = "flutter.createProject";
	}));
	context.subscriptions.push(commands.registerCommand("flutter.doctor", (_) => {
		sdks.projectType = ProjectType.Flutter;
		commandToReRun = "flutter.doctor";
	}));
	// Wait a while before showing the error to allow the code above to have run.
	setTimeout(() => {
		if (sdks.projectType === ProjectType.Flutter) {
			if (sdks.flutter && !sdks.dart) {
				showFluttersDartSdkActivationFailure();
			} else {
				showFlutterActivationFailure(commandToReRun);
			}
		} else {
			showDartActivationFailure();
		}
		analytics.logSdkDetectionFailure();
	}, 250);
	return;
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
				const matchingSdkFolder = search(selectedFolders.map(fsPath));
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

export function findSdks(): Sdks {
	const folders = getDartWorkspaceFolders()
		.map((w) => fsPath(w.uri));
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

export function referencesFlutterSdk(folder: string): boolean {
	if (folder && fs.existsSync(path.join(folder, "pubspec.yaml"))) {
		const regex = new RegExp("sdk\\s*:\\s*flutter", "i");
		return regex.test(fs.readFileSync(path.join(folder, "pubspec.yaml")).toString());
	}
	return false;
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

export const hasDartExecutable = (pathToTest: string) => hasExecutable(pathToTest, dartExecutableName);
export const hasFlutterExecutable = (pathToTest: string) => hasExecutable(pathToTest, flutterExecutableName);

function hasExecutable(pathToTest: string, executableName: string): boolean {
	return fs.existsSync(path.join(pathToTest, executableName));
}

export function searchPaths(paths: string[], filter: (s: string) => boolean, executableName: string): string {
	let sdkPath =
		paths
			.filter((p) => p)
			.map(resolvePaths)
			.map((p) => path.basename(p) !== "bin" ? path.join(p, "bin") : p) // Ensure /bin on end.
			.find(filter);

	// In order to handle symlinks on the binary (not folder), we need to add the executableName and then realpath.
	sdkPath = sdkPath && fs.realpathSync(path.join(sdkPath, executableName));

	// Then we need to take the executable name and /bin back off
	sdkPath = sdkPath && path.dirname(path.dirname(sdkPath));

	return sdkPath;
}
