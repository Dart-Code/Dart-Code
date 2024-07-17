import * as fs from "fs";
import * as path from "path";
import * as semver from "semver";
import { commands, Uri, window } from "vscode";
import { Logger, Sdks } from "../../shared/interfaces";
import { PackageMap } from "../../shared/pub/package_map";
import { fsPath, getPubGeneratorVersion as getPubGeneratorSdkVersion, isWithinPath } from "../../shared/utils/fs";

export interface PubPackageStatus { folderUri: Uri, pubRequired: false | "GET" | "UPGRADE", reason?: string }

export function getPubWorkspaceStatus(
	sdks: Sdks,
	logger: Logger,
	folderUris: Uri[],
	includeDates = true,
	existsSync: (itemPath: string) => boolean = fs.existsSync,
	readFileSync: (itemPath: string) => string = (p) => fs.readFileSync(p).toString(),
	mtimeSync: (itemPath: string) => Date = (p) => fs.statSync(p).mtime,
): PubPackageStatus[] {
	return folderUris.map((folderUri) => getPubPackageStatus(sdks, logger, folderUri, includeDates, existsSync, readFileSync, mtimeSync));
}

export function getPubPackageStatus(
	sdks: Sdks,
	logger: Logger,
	folderUri: Uri,
	includeDates = true,
	existsSync: (itemPath: string) => boolean = fs.existsSync,
	readFileSync: (itemPath: string) => string = (p) => fs.readFileSync(p).toString(),
	mtimeSync: (itemPath: string) => Date = (p) => fs.statSync(p).mtime,
): PubPackageStatus {
	const folder = fsPath(folderUri);
	const pubspecPath = path.join(folder, "pubspec.yaml");
	const pubspecLockPath = path.join(folder, "pubspec.lock");
	const packageMapPath = path.join(folder, ".dart_tool", "package_config.json");
	if (!folder || !existsSync(pubspecPath))
		return { folderUri, pubRequired: false, reason: "Folder or pubspec do not exist" };

	// If a folder starts with '__' or '{' then it's probably a template of some
	// sort and we shouldn't run.
	if (folder.includes("__") || folder.includes("{"))
		return { folderUri, pubRequired: false, reason: "Folder starts with __ or { and looks like a template folder" };

	// If we don't appear to have deps listed in pubspec, then no point prompting.
	const regex = new RegExp("dependencies\\s*:", "i");
	if (!regex.test(readFileSync(pubspecPath)))
		return { folderUri, pubRequired: false, reason: "Pubspec does not contain any dependencies" };

	// If we don't have package_config, we probably need running.
	if (!existsSync(packageMapPath))
		return { folderUri, pubRequired: "GET", reason: "The .dart_tool/package_config.json file is missing" };

	// If the Dart SDK version has upgraded by more than just a patch, we should
	// prefer upgrade.
	const lastUsedSdkVersion = getPubGeneratorSdkVersion(logger, packageMapPath);
	const currentSdkVersion = sdks.dartVersion;
	if (lastUsedSdkVersion && currentSdkVersion) {
		const lastUsedSdkMajorMinor = `${semver.major(lastUsedSdkVersion)}.${semver.minor(lastUsedSdkVersion)}.0`;
		const currentSdkMajorMinor = `${semver.major(currentSdkVersion)}.${semver.minor(currentSdkVersion)}.0`;

		logger.info(`Version last used for Pub is ${lastUsedSdkVersion} (${lastUsedSdkMajorMinor}), current is ${currentSdkVersion} (${currentSdkMajorMinor})`);
		// For an SDK upgrade, we want to encourage upgrading.
		if (semver.gt(currentSdkMajorMinor, lastUsedSdkMajorMinor))
			return { folderUri, pubRequired: "UPGRADE", reason: `The current SDK version (${currentSdkMajorMinor}) is newer than the one last used to run "pub get" (${lastUsedSdkMajorMinor})` };
		// For a downgrade, Pub Get is enough to fix.
		else if (semver.lt(currentSdkMajorMinor, lastUsedSdkMajorMinor))
			return { folderUri, pubRequired: "GET", reason: `The current SDK version (${currentSdkMajorMinor}) is older than the one last used to run "pub get" (${lastUsedSdkMajorMinor})` };
	}

	const pubspecModified = mtimeSync(pubspecPath);
	const pubspecLockModified = existsSync(pubspecLockPath)
		? mtimeSync(pubspecLockPath)
		: pubspecModified;
	const packageMapModified = mtimeSync(packageMapPath);

	const maybeDate = includeDates ? (d: Date) => ` (${d})` : (d: Date) => "";

	if (pubspecModified > packageMapModified) {
		return { folderUri, pubRequired: "GET", reason: `The pubspec.yaml file was modified${maybeDate(pubspecModified)} more recently than the .dart_tool/package_config.json file${maybeDate(packageMapModified)}` };
	} else if (pubspecModified > pubspecLockModified) {
		return { folderUri, pubRequired: "GET", reason: `The pubspec.yaml file was modified${maybeDate(pubspecModified)} more recently than the pubspec.lock file${maybeDate(pubspecLockModified)}` };
	} else if (pubspecLockModified > packageMapModified) {
		return { folderUri, pubRequired: "GET", reason: `The pubspec.lock file was modified${maybeDate(pubspecLockModified)} more recently than the .dart_tool/package_config.json file${maybeDate(packageMapModified)}` };
	}

	// If we're a Flutter project and our SDK doesn't match the one used
	// in the package file, we also need running.
	if (sdks.flutter) {
		const packageMap = PackageMap.loadForProject(logger, folder);
		const flutterPackagePath = packageMap.getPackagePath("flutter");
		if (flutterPackagePath && !isWithinPath(flutterPackagePath, sdks.flutter)) {
			return { folderUri, pubRequired: "GET", reason: `The referenced Flutter package (${flutterPackagePath}) does not match the current SDK in use (${sdks.flutter})` };
		}
	}

	return { folderUri, pubRequired: false, reason: "Up-to-date" };
}

export async function promptToRunPubGet(folders: Uri[]) {
	const label = "Run 'pub get'";
	const clickedButton = await window.showInformationMessage("Some packages are missing or out of date, would you like to get them now?", label);
	if (clickedButton === label)
		await runPubGet(folders);
}

export function runPubGet(folders: Uri[]) {
	return commands.executeCommand("dart.getPackages", folders);
}


export async function promptToRunPubUpgrade(folders: Uri[]) {
	const label = "Run 'pub upgrade'";
	const clickedButton = await window.showInformationMessage("Your SDK has been updated since you last fetched packages, would you like to fetch updated packages?", label);
	if (clickedButton === label)
		await runPubUpgrade(folders);
}

export function runPubUpgrade(folders: Uri[]) {
	return commands.executeCommand("dart.upgradePackages", folders);
}
