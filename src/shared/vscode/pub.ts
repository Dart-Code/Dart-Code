import * as fs from "fs";
import * as path from "path";
import * as semver from "semver";
import { commands, Uri, window } from "vscode";
import * as YAML from "yaml";
import { Logger, Sdks } from "../../shared/interfaces";
import { PackageMap } from "../../shared/pub/package_map";
import { fsPath, getPubGeneratorVersion, isWithinPath } from "../../shared/utils/fs";

export interface PubPackageStatus { folderUri: Uri, pubRequired: false | "GET" | "UPGRADE", reason?: string, workspace: "NONE" | "ROOT" | "PROJECT" }

const pubspecHasDependenciesRegex = new RegExp("^(dev_)?dependencies\\s*:", "im");
const pubspecIsWorkspaceProjectRegex = new RegExp("^resolution\\s*:\\s*workspace", "im");
const pubspecIsWorkspaceRootRegex = new RegExp("^workspace\\s*:", "im");

export function getPubWorkspaceStatus(
	sdks: Sdks,
	logger: Logger,
	folderUris: Uri[],
	includeDates = true,
	existsSync: (itemPath: string) => boolean = fs.existsSync,
	readFileSync: (itemPath: string) => string = (p) => fs.readFileSync(p, "utf8").toString(),
	mtimeSync: (itemPath: string) => Date = (p) => fs.statSync(p).mtime,
): PubPackageStatus[] {
	// Compute the statuses for the requested packages.
	const statuses = folderUris.map((folderUri) => getPubPackageStatus(sdks, logger, folderUri, includeDates, existsSync, readFileSync, mtimeSync));

	// For any workspace projects, we need to also check their roots if they were not already in the initial set.
	const workspaceProjects = statuses.filter((s) => s.workspace === "PROJECT");
	if (workspaceProjects.length) {
		logger.info(`Found ${workspaceProjects.length} Pub workspace projects with roots that are not already in the set`);
		const includedWorkspaceRootPaths = new Set<string>();
		statuses.filter((s) => s.workspace === "ROOT").forEach((p) => includedWorkspaceRootPaths.add(fsPath(p.folderUri)));

		projectLoop:
		for (const project of workspaceProjects) {
			const folderPath = fsPath(project.folderUri);
			let currentFolder = path.dirname(folderPath);
			while (true) {
				// First check if the current folder is already a root we know about.
				if (includedWorkspaceRootPaths.has(currentFolder)) {
					continue projectLoop;
				}
				// Otherwise, see if it is actually the root.
				let isRoot = false;
				try {
					isRoot = pubspecIsWorkspaceRootRegex.test(readFileSync(path.join(currentFolder, "pubspec.yaml")));
				} catch {
					// File may not exist, but using exists first is a race, so just try to read and ignore failure.
				}

				if (isRoot) {
					logger.info(`Found new Pub workspace root at ${currentFolder}`);
					// We found the root, add the result and to our set so we don't repeat this work.
					statuses.push(getPubPackageStatus(sdks, logger, Uri.file(currentFolder), includeDates, existsSync, readFileSync, mtimeSync));
					includedWorkspaceRootPaths.add(currentFolder);
					continue projectLoop;
				}

				// Otherwise, try the next folder up.
				const parent = path.dirname(currentFolder);
				if (parent === currentFolder) {
					logger.warn(`Failed to find a Pub workspace root for project at ${folderPath} before getting to root folder`);
					continue projectLoop;
				}
				currentFolder = parent;
			}
		}
	}

	return statuses;
}

function getWorkspaceFolderPaths(
	logger: Logger,
	folder: string,
	pubspecContent: string,
): string[] {
	try {
		const yaml = YAML.parse(pubspecContent);
		const workspaceList = yaml.workspace;
		if (Array.isArray(workspaceList) && workspaceList.every((s: unknown) => typeof s === "string")) {
			return workspaceList.map((s) => path.join(folder, s));
		} else {
			logger.error(`Failed to parse pubspec workspaces, items are not all strings`);
			return [];
		}
	} catch (e) {
		logger.error(`Failed to parse pubspec workspaces`);
		return [];
	}
}

export function isValidPubGetTarget(folderUri: Uri): { valid: true } | { valid: false, reason: string } {
	const folderPath = fsPath(folderUri);

	// If a folder starts with '__' or '{' then it's probably a template of some
	// sort and we shouldn't run.
	if (folderPath.includes("__") || folderPath.includes("{"))
		return { valid: false, reason: "Folder includes __ or { and looks like a template folder" };

	return { valid: true };
}

function getPubPackageStatus(
	sdks: Sdks,
	logger: Logger,
	folderUri: Uri,
	includeDatesAndFullPaths = true,
	existsSync: (itemPath: string) => boolean = fs.existsSync,
	readFileSync: (itemPath: string) => string = (p) => fs.readFileSync(p, "utf8").toString(),
	mtimeSync: (itemPath: string) => Date = (p) => fs.statSync(p).mtime,
): PubPackageStatus {
	const folder = fsPath(folderUri);
	const pubspecPath = path.join(folder, "pubspec.yaml");
	const pubspecLockPath = path.join(folder, "pubspec.lock");
	const packageMapPath = path.join(folder, ".dart_tool", "package_config.json");
	if (!folder || !existsSync(pubspecPath))
		return { folderUri, pubRequired: false, reason: "Folder or pubspec do not exist", workspace: "NONE" };

	const isValid = isValidPubGetTarget(folderUri);
	if (!isValid.valid)
		return { folderUri, pubRequired: false, reason: isValid.reason, workspace: "NONE" };

	const pubspecContent = readFileSync(pubspecPath);
	const hasDependencies = pubspecHasDependenciesRegex.test(pubspecContent);
	const isWorkspaceProject = pubspecIsWorkspaceProjectRegex.test(pubspecContent);
	const isWorkspaceRoot = pubspecIsWorkspaceRootRegex.test(pubspecContent);

	const result: Partial<PubPackageStatus> & { folderUri: Uri, workspace: string } = { folderUri, workspace: isWorkspaceRoot ? "ROOT" : isWorkspaceProject ? "PROJECT" : "NONE" };

	// If we don't appear to have deps listed in pubspec, then no point prompting.
	if (!isWorkspaceRoot && !hasDependencies)
		return { ...result, pubRequired: false, reason: "Pubspec does not contain any dependencies" };

	// If we are part of a pub workspace, we don't do anything, it's handled by the root.
	if (isWorkspaceProject)
		return { ...result, pubRequired: false, reason: "The project is part of a Pub workspace" };

	// If we don't have package_config, we probably need running.
	if (!existsSync(packageMapPath))
		return { ...result, pubRequired: "GET", reason: "The .dart_tool/package_config.json file is missing" };

	// If the Dart SDK version has upgraded by more than just a patch, we should
	// prefer upgrade.
	const lastUsedSdkVersion = getPubGeneratorVersion(logger, packageMapPath, existsSync, readFileSync);
	const currentSdkVersion = sdks.dartVersion;
	if (lastUsedSdkVersion && currentSdkVersion) {
		const lastUsedSdkMajorMinor = `${semver.major(lastUsedSdkVersion)}.${semver.minor(lastUsedSdkVersion)}.0`;
		const currentSdkMajorMinor = `${semver.major(currentSdkVersion)}.${semver.minor(currentSdkVersion)}.0`;

		logger.info(`Version last used for Pub is ${lastUsedSdkVersion} (${lastUsedSdkMajorMinor}), current is ${currentSdkVersion} (${currentSdkMajorMinor})`);
		// For an SDK upgrade, we want to encourage upgrading.
		if (semver.gt(currentSdkMajorMinor, lastUsedSdkMajorMinor))
			return { ...result, pubRequired: "UPGRADE", reason: `The current SDK version (${currentSdkVersion}) is newer than the one last used to run "pub get" (${lastUsedSdkVersion})` };
		// For a downgrade, Pub Get is enough to fix.
		else if (semver.lt(currentSdkMajorMinor, lastUsedSdkMajorMinor))
			return { ...result, pubRequired: "GET", reason: `The current SDK version (${currentSdkVersion}) is older than the one last used to run "pub get" (${lastUsedSdkVersion})` };
	}


	// Helpers for Date/Paths so that output is complete for production, but simplified for tests.
	const tryMtimeSync = (f: string) => { try { return mtimeSync(f); } catch { return undefined; } };
	const maybeDate = includeDatesAndFullPaths
		? (d: Date) => ` (${d})`
		: (_: Date) => "";
	const displayPath = includeDatesAndFullPaths
		? (p: string) => p
		: (p: string) => path.basename(p) === "package_config.json" ? `${path.basename(path.dirname(path.dirname(p)))}/${path.basename(path.dirname(p))}/${path.basename(p)}` : `${path.basename(path.dirname(p))}/${path.basename(p)}`;

	const pubspecLockModified = tryMtimeSync(pubspecLockPath);
	const packageMapModified = tryMtimeSync(packageMapPath);
	if (pubspecLockModified && packageMapModified && pubspecLockModified > packageMapModified) {
		return { ...result, pubRequired: "GET", reason: `The ${displayPath(pubspecLockPath)} file was modified${maybeDate(pubspecLockModified)} more recently than the ${displayPath(packageMapPath)} file${maybeDate(packageMapModified)}` };
	}

	const relevantProjectFolders = isWorkspaceRoot ? [folder, ...getWorkspaceFolderPaths(logger, folder, pubspecContent)] : [folder];
	for (const relevantProjectFolder of relevantProjectFolders) {
		const relevantPubspecYamlPath = path.join(relevantProjectFolder, "pubspec.yaml");
		const pubspecModified = tryMtimeSync(relevantPubspecYamlPath);
		if (!pubspecModified)
			continue;

		if (packageMapModified && pubspecModified > packageMapModified) {
			return { ...result, pubRequired: "GET", reason: `The ${displayPath(relevantPubspecYamlPath)} file was modified${maybeDate(pubspecModified)} more recently than the ${displayPath(packageMapPath)} file${maybeDate(packageMapModified)}` };
		} else if (pubspecLockModified && pubspecModified > pubspecLockModified) {
			return { ...result, pubRequired: "GET", reason: `The ${displayPath(relevantPubspecYamlPath)} file was modified${maybeDate(pubspecModified)} more recently than the ${displayPath(pubspecLockPath)} file${maybeDate(pubspecLockModified)}` };
		}
	}

	// If we're a Flutter project and our SDK doesn't match the one used
	// in the package file, we also need running.
	if (sdks.flutter) {
		const packageMap = PackageMap.loadForProject(logger, folder);
		const flutterPackagePath = packageMap.getPackagePath("flutter");
		if (flutterPackagePath && !isWithinPath(flutterPackagePath, sdks.flutter)) {
			return { ...result, pubRequired: "GET", reason: `The referenced Flutter package (${flutterPackagePath}) does not match the current SDK in use (${sdks.flutter})` };
		}
	}

	return { ...result, pubRequired: false, reason: "Up-to-date" };
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
