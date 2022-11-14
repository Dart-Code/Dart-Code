import * as fs from "fs";
import * as path from "path";
import * as semver from "semver";
import { commands, Uri, window } from "vscode";
import { Logger, Sdks } from "../../shared/interfaces";
import { PackageMap } from "../../shared/pub/package_map";
import { fsPath, getPubGeneratorVersion as getPubGeneratorSdkVersion, isWithinPath } from "../../shared/utils/fs";

// TODO: Wrap these up into a class.

export function getPubPackageStatus(sdks: Sdks, logger: Logger, folderUri: Uri): { probablyRequiresGet: true, probablyRequiresUpgrade: boolean } | undefined {
	const nonRequired = undefined;
	const getRequired = { probablyRequiresGet: true as const, probablyRequiresUpgrade: false };
	const upgradeRequired = { probablyRequiresGet: true as const, probablyRequiresUpgrade: true };

	const folder = fsPath(folderUri);
	const pubspecPath = path.join(folder, "pubspec.yaml");
	const pubspecLockPath = path.join(folder, "pubspec.lock");
	const packageMapPath = path.join(folder, ".dart_tool", "package_config.json");
	if (!folder || !fs.existsSync(pubspecPath))
		return nonRequired;

	// If we don't appear to have deps listed in pubspec, then no point prompting.
	const regex = new RegExp("dependencies\\s*:", "i");
	if (!regex.test(fs.readFileSync(pubspecPath).toString()))
		return nonRequired;

	// If we don't have package_config, we probably need running.
	if (!fs.existsSync(packageMapPath))
		return getRequired;

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
			return upgradeRequired;
		// For a downgrade, Pub Get is enough to fix.
		else if (semver.lt(currentSdkMajorMinor, lastUsedSdkMajorMinor))
			return getRequired;
	}

	const pubspecModified = fs.statSync(pubspecPath).mtime;
	const pubspecLockModified = fs.existsSync(pubspecLockPath)
		? fs.statSync(pubspecLockPath).mtime
		: pubspecModified;
	const packageMapModified = fs.statSync(packageMapPath).mtime;

	if (!(pubspecModified <= pubspecLockModified && pubspecLockModified <= packageMapModified))
		return getRequired;

	// If we're a Flutter project and our SDK doesn't match the one used
	// in the package file, we also need running.
	if (sdks.flutter) {
		const packageMap = PackageMap.loadForProject(logger, folder);
		const flutterPackagePath = packageMap.getPackagePath("flutter");
		if (flutterPackagePath && !isWithinPath(flutterPackagePath, sdks.flutter)) {
			return getRequired;
		}
	}

	return nonRequired;
}

export async function promptToRunPubGet(folders: Uri[]) {
	const label = "Get packages";
	const clickedButton = await window.showInformationMessage("Some packages are missing or out of date, would you like to get them now?", label);
	if (clickedButton === label)
		await runPubGet(folders);
}

export function runPubGet(folders: Uri[]) {
	return commands.executeCommand("dart.getPackages", folders);
}


export async function promptToRunPubUpgrade(folders: Uri[]) {
	const label = "Upgrade packages";
	const clickedButton = await window.showInformationMessage("Your SDK has been updated since you last fetched packages, would you like to fetch upgraded packages?", label);
	if (clickedButton === label)
		await runPubUpgrade(folders);
}

export function runPubUpgrade(folders: Uri[]) {
	return commands.executeCommand("dart.upgradePackages", folders);
}
