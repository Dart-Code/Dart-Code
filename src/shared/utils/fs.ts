import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as semver from "semver";
import { FLUTTER_CREATE_PROJECT_TRIGGER_FILE, isWin } from "../constants";
import { Logger, MyCancellationToken } from "../interfaces";
import { nullLogger } from "../logging";
import { PackageMap } from "../pub/package_map";
import { nullToUndefined } from "../utils";
import { sortBy } from "./array";

export function fsPath(uri: { fsPath: string } | string, { useRealCasing = false }: { useRealCasing?: boolean; } = {}) {
	// tslint:disable-next-line:disallow-fspath
	let newPath = typeof uri === "string" ? uri : uri.fsPath;

	if (useRealCasing) {
		const realPath = fs.existsSync(newPath) && fs.realpathSync.native(newPath);
		// Since realpathSync.native will resolve symlinks, only do anything if the paths differ
		// _only_ by case.
		// when there was no symlink (eg. the lowercase version of both paths match).
		if (realPath && realPath.toLowerCase() === newPath.toLowerCase() && realPath !== newPath) {
			console.warn(`Rewriting path:\n  ${newPath}\nto:\n  ${realPath} because the casing appears munged`);
			newPath = realPath;
		}
	}

	newPath = forceWindowsDriveLetterToUppercase(newPath);

	return newPath;
}

export function forceWindowsDriveLetterToUppercase<T extends string | undefined>(p: T): string | (undefined extends T ? undefined : never) {
	if (typeof p !== "string")
		return undefined as (undefined extends T ? undefined : never);

	if (p && isWin && path.isAbsolute(p) && p.startsWith(p.charAt(0).toLowerCase()))
		return p.substr(0, 1).toUpperCase() + p.substr(1);

	return p;
}

export function isWithinPath(file: string, folder: string) {
	const relative = path.relative(folder.toLowerCase(), file.toLowerCase());
	return !!relative && !relative.startsWith("..") && !path.isAbsolute(relative);
}

export function isWithinPathOrEqual(file: string, folder: string) {
	const relative = path.relative(folder, file);
	return !relative || isWithinPath(file, folder);
}

export function isEqualOrWithinPath(file: string, folder: string) {
	const relative = path.relative(folder.toLowerCase(), file.toLowerCase());
	return relative === "" || (!!relative && !relative.startsWith("..") && !path.isAbsolute(relative));
}

export async function getChildFolders(logger: Logger, parent: string, options?: { allowBin?: boolean; allowCache?: boolean }): Promise<string[]> {
	if (!fs.existsSync(parent))
		return [];
	const files = await readDirAsync(logger, parent);

	return files.filter((f) => f.isDirectory())
		.filter((f) => f.name !== "bin" || (options && options.allowBin)) // Don't look in bin folders
		.filter((f) => f.name !== "cache" || (options && options.allowCache)) // Don't look in cache folders
		.map((item) => path.join(parent, item.name));
}

export function readDirAsync(logger: Logger, folder: string): Promise<fs.Dirent[]> {
	return new Promise<fs.Dirent[]>((resolve) => fs.readdir(folder,
		{ withFileTypes: true },
		(err, files) => {
			// We will generate errors if we don't have access to this folder
			// so just skip over it.
			if (err) {
				logger.warn(`Skipping folder ${folder} due to error: ${err}`);
				resolve([]);
			} else {
				resolve(files);
			}
		},
	));
}

export function hasPackageMapFile(folder: string): boolean {
	return fs.existsSync(path.join(folder, ".dart_tool", "package_config.json")) || fs.existsSync(path.join(folder, ".packages"));
}

export function hasPubspec(folder: string): boolean {
	return fs.existsSync(path.join(folder, "pubspec.yaml"));
}

export async function hasPubspecAsync(folder: string): Promise<boolean> {
	return await fileExists(path.join(folder, "pubspec.yaml"));
}

export async function hasCreateTriggerFileAsync(folder: string): Promise<boolean> {
	return await fileExists(path.join(folder, FLUTTER_CREATE_PROJECT_TRIGGER_FILE));
}

export async function isFlutterRepoAsync(folder: string): Promise<boolean> {
	return await fileExists(path.join(folder, "bin/flutter")) && await fileExists(path.join(folder, "bin/cache/dart-sdk"));
}

export function isFlutterProjectFolder(folder?: string): boolean {
	return projectReferencesFlutterSdk(folder);
}

export function projectReferencesFlutterSdk(folder?: string): boolean {
	if (folder && hasPubspec(folder)) {
		return pubspecContentReferencesFlutterSdk(fs.readFileSync(path.join(folder, "pubspec.yaml")).toString());
	}
	return false;
}

export function pubspecContentReferencesFlutterSdk(content: string): boolean {
	const regex = new RegExp("sdk\\s*:\\s*[\"']?flutter[\"']?", "i");
	return regex.test(content);
}

export function referencesBuildRunner(folder?: string): boolean {
	if (folder && hasPubspec(folder)) {
		const regex = new RegExp("build_runner\\s*:", "i");
		return regex.test(fs.readFileSync(path.join(folder, "pubspec.yaml")).toString());
	}
	return false;
}

export function extractFlutterSdkPathFromPackagesFile(projectFolder: string): string | undefined {
	if (!fs.existsSync(projectFolder))
		return undefined;

	let packagePath = PackageMap.loadForProject(nullLogger, projectFolder).getPackagePath("flutter");

	if (!packagePath)
		return undefined;

	// Set windows slashes to / while manipulating.
	if (isWin) {
		packagePath = packagePath.replace(/\\/g, "/");
	}

	// Make sure ends with a slash.
	if (!packagePath.endsWith("/"))
		packagePath = packagePath + "/";

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
		if (packagePath.startsWith("\\"))
			packagePath = packagePath.substring(1);
	}

	return packagePath;
}

async function fileExists(p: string): Promise<boolean> {
	try {
		await fs.promises.access(p);
		return true;
	} catch {
		return false;
	}
}

export function resolveTildePaths<T extends string | undefined>(p: T): string | (undefined extends T ? undefined : never) {
	if (typeof p !== "string")
		return undefined as (undefined extends T ? undefined : never);

	if (p.startsWith("~/"))
		return path.join(os.homedir(), p.substr(2));

	return p;
}

// Walks a few levels down and returns all folders that look like project
// folders, such as:
// - have a pubspec.yaml
// - have a project create trigger file
// - are the Flutter repo root
export async function findProjectFolders(logger: Logger, roots: string[], excludedFolders: string[], options: { sort?: boolean; requirePubspec?: boolean, searchDepth: number, onlyWorkspaceRoots?: boolean }, token: MyCancellationToken): Promise<string[]> {
	const dartToolFolderName = `${path.sep}.dart_tool${path.sep}`;

	let previousLevelFolders = roots.slice();
	let allPossibleFolders = previousLevelFolders.slice();
	// Start at 1, as we already added the roots.
	const searchDepth = options.onlyWorkspaceRoots ? 1 : options.searchDepth;
	for (let i = 1; i < searchDepth; i++) {
		let nextLevelFolders: string[] = [];
		for (const folder of previousLevelFolders) {
			if (token.isCancellationRequested)
				break;
			nextLevelFolders = nextLevelFolders.concat(await getChildFolders(logger, folder));
		}

		allPossibleFolders = allPossibleFolders.concat(nextLevelFolders);
		previousLevelFolders = nextLevelFolders;
	}

	allPossibleFolders = allPossibleFolders
		.filter((f) => !f.includes(dartToolFolderName) && excludedFolders.every((ef) => !isEqualOrWithinPath(f, ef)));

	const projectFolderPromises = allPossibleFolders.map(async (folder) => ({
		exists: options && options.requirePubspec
			? await hasPubspecAsync(folder)
			: options.onlyWorkspaceRoots || await hasPubspecAsync(folder) || await hasCreateTriggerFileAsync(folder) || await isFlutterRepoAsync(folder),
		folder,
	}));
	const projectFoldersChecks = await Promise.all(projectFolderPromises);
	const projectFolders = projectFoldersChecks
		.filter((res) => res.exists)
		.map((res) => res.folder);

	return options && options.sort
		? sortBy(projectFolders, (p) => p.toLowerCase())
		: projectFolders;
}

export function getSdkVersion(logger: Logger, { sdkRoot }: { sdkRoot?: string }): string | undefined {
	if (!sdkRoot)
		return undefined;
	const versionFile = path.join(sdkRoot, "version");
	if (!fs.existsSync(versionFile))
		return undefined;
	try {
		return nullToUndefined(
			semver.valid(
				fs
					.readFileSync(versionFile, "utf8")
					.trim()
					.split("\n")
					.filter((l) => l)
					.filter((l) => l.trim().substr(0, 1) !== "#")
					.join("\n")
					.trim()
			)
		);
	} catch (e) {
		logger.error(e);
		return undefined;
	}
}

export function tryDeleteFile(filePath: string) {
	if (fs.existsSync(filePath)) {
		try {
			fs.unlinkSync(filePath);
		} catch {
			console.warn(`Failed to delete file ${path}.`);
		}
	}
}

export function getRandomInt(min: number, max: number) {
	min = Math.ceil(min);
	max = Math.floor(max);
	return Math.floor(Math.random() * (max - min)) + min;
}

export function mkDirRecursive(folder: string) {
	const parent = path.dirname(folder);
	if (!fs.existsSync(parent))
		mkDirRecursive(parent);
	if (!fs.existsSync(folder))
		fs.mkdirSync(folder);
}

export function areSameFolder(folder1: string, folder2: string) {
	// Trim any trailing path separators of either direction.
	folder1 = folder1.replace(/[\\/]+$/, "");
	folder2 = folder2.replace(/[\\/]+$/, "");

	return folder1 === folder2;
}

export function normalizeSlashes(p: string) {
	return p.replace(/[\\/]/g, path.sep);
}

/**
 * Gets a unique path or filename for the specified {folderUri} location, appending a numerical value
 * between {prefix} and suffix, as required.
 *
 * A directory/file location will be generated from {prefix} with a trailing number (eg. `mydir1`) and
 * its existence will be checked; if it already exists, the number will be incremented and checked again.
 *
 * This will continue until a non-existent directory/file is available, or until the maxiumum search
 * limit (of 128) is reached.
 *
 * @param folder directory to check for existing directories or files.
 * @param prefix prefix of the directory/file
 * @param suffix suffix of the directory/file
 */
export function nextAvailableFilename(folder: string, prefix: string, suffix: string = ""): string {
	// Set an upper bound on how many attempts we should make in getting a non-existent name.
	const maxSearchLimit = 128;

	for (let index = 1; index <= maxSearchLimit; index++) {
		const name = `${prefix}${index}${suffix}`;
		const fullPath = path.join(folder, name);

		if (!fs.existsSync(fullPath)) {
			// Name doesn't appear to exist on-disk and thus can be used - return it.
			return name;
		}
	}

	// We hit the search limit, so return {prefix}{index} (eg. mydir1) and allow the extension to
	// handle the already-exists condition if user doesn't change it manually.
	return `${prefix}1${suffix}`;
}
