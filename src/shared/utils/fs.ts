import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as semver from "semver";
import { URI } from "vscode-uri";
import * as YAML from "yaml";
import { FLUTTER_CREATE_PROJECT_TRIGGER_FILE, isWin } from "../constants";
import { Logger, MyCancellationToken } from "../interfaces";
import { nullLogger } from "../logging";
import { PackageMap } from "../pub/package_map";
import { nullToUndefined } from "../utils";
import { sortBy } from "./array";

export function fsPath(uri: URI, { useRealCasing = false }: { useRealCasing?: boolean; } = {}): string {
	// tslint:disable-next-line:disallow-fspath
	let newPath = typeof uri === "string" ? uri : uri.fsPath;

	if (useRealCasing) {
		const realPath = fs.existsSync(newPath) && fs.realpathSync.native(newPath);
		// Since realpathSync.native will resolve symlinks, only do anything if the paths differ
		// _only_ by case.
		// when there was no symlink (eg. the lowercase version of both paths match).
		if (realPath && realPath.toLowerCase() === newPath.toLowerCase() && realPath !== newPath) {
			console.warn(`Rewriting path:\n  ${newPath}\nto:\n  ${realPath} because the casing appears incorrect`);
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

export function forceWindowsDriveLetterToUppercaseInUriString<T extends string | undefined>(uriString: T): string | (undefined extends T ? undefined : never) {
	if (typeof uriString !== "string")
		return undefined as (undefined extends T ? undefined : never);

	return uriString.replace(/^([\w+-.]+):(\/\/\w*)?\/(\w)(:|%3A)\//, (match, scheme, authority, driveLetter, colon) => `${scheme}:${authority ?? ""}/${driveLetter.toUpperCase()}${colon}/`);
}

/**
 * Returns a string for comparing URIs. For file (and dart-macro+file) URIs this will
 * be `fsPath()` (including for fake paths for generated files) with a `file:` or `dart-macro+file`
 * prefix (this will NOT be a valid URI). On Windows, the string will be lowercased.
 * For other URIs, it is the toString().
 *
 * This string is ONLY for comparising URIs to see if they are "the same document".
 */
export function uriComparisonString(uri: URI): string {
	if (uri.scheme === "file" || uri.scheme.endsWith("+file")) {
		const uriString = `${uri.scheme}:${fsPath(uri.with({ scheme: "file" }))}`;
		// VS Code treats Windows as case-insensitive and not others (regardless
		// of the actual file system settings).
		return isWin ? uriString.toLowerCase() : uriString;
	} else {
		return uri.toString();
	}
}

/// Shortens a path to use ~ if it's inside the home directory and always
// uses forward slashes in that case.
export function homeRelativePath(p: string | undefined) {
	if (!p) return undefined;
	const homedir = os.homedir();
	if (isWithinPath(p, homedir)) {
		if (isWin)
			return path.join("~", path.relative(homedir, p)).replace(/\\/g, "/");
		else
			return path.join("~", path.relative(homedir, p));
	}
	return p;
}

export function isWithinPath(file: string, folder: string) {
	const relative = path.relative(folder.toLowerCase(), file.toLowerCase());
	return !!relative && !relative.startsWith("..") && !path.isAbsolute(relative);
}

export function isWithinPathOrEqual(file: string, folder: string) {
	const relative = path.relative(folder.toLowerCase(), file.toLowerCase());
	return relative === "" || (!!relative && !relative.startsWith("..") && !path.isAbsolute(relative));
}

export function findCommonAncestorFolder(folderPaths: string[]): string | undefined {
	if (!folderPaths.length)
		return undefined;

	const commonAncestorSegments = folderPaths[0].split(path.sep);
	for (const folderPath of folderPaths.slice(1)) {
		const pathSegments = folderPath.split(path.sep);
		for (let i = 0; i < Math.min(commonAncestorSegments.length, pathSegments.length); i++) {
			if (commonAncestorSegments[i] !== pathSegments[i]) {
				commonAncestorSegments.splice(i);
				break;
			}
		}
		if (commonAncestorSegments.length > pathSegments.length) {
			commonAncestorSegments.splice(pathSegments.length);
		}
	}

	// If we got up to the root, consider that not a match.
	if (commonAncestorSegments.length <= 1)
		return undefined;

	return commonAncestorSegments.join(path.sep);
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
	return projectReferencesFlutter(folder);
}

export function projectReferencesFlutter(folder?: string): boolean {
	if (folder && hasPubspec(folder)) {
		const pubspecPath = path.join(folder, "pubspec.yaml");
		try {
			const pubspecContent = fs.readFileSync(pubspecPath);
			return pubspecContentReferencesFlutter(pubspecContent.toString());
		} catch (e: any) {
			if (e?.code !== "ENOENT") // Don't warn for missing files.
				console.warn(`Failed to read ${pubspecPath}: ${e}`);
		}
	}
	return false;
}

export function pubspecContentReferencesFlutter(content: string) {
	try {
		const yaml = YAML.parse(content.toString());
		return !!(
			yaml?.dependencies?.flutter
			|| yaml?.dev_dependencies?.flutter
			|| yaml?.dependencies?.sky_engine
			|| yaml?.dev_dependencies?.sky_engine
			|| yaml?.dependencies?.flutter_test
			|| yaml?.dev_dependencies?.flutter_test
			|| yaml?.dependencies?.flutter_goldens
			|| yaml?.dev_dependencies?.flutter_goldens
		);
	} catch {
		return false;
	}
}

export function tryGetPackageName(packageDirectory: string): string | undefined {
	try {
		const yaml = YAML.parse(fs.readFileSync(path.join(packageDirectory, "pubspec.yaml")).toString());
		return yaml?.name ? yaml?.name : undefined;
	} catch {
		return undefined;
	}
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
		.filter((f) => !f.includes(dartToolFolderName) && excludedFolders.every((ef) => !isWithinPathOrEqual(f, ef)));

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

	// Try to read the new JSON file for Flutter. Don't use exist checks as it races,
	// just try to read and see if we get contents.
	const jsonVersionFile = path.join(sdkRoot, "bin", "cache", "flutter.version.json");
	let jsonVersionFileContent: string | undefined;
	try {
		jsonVersionFileContent = fs.readFileSync(jsonVersionFile, "utf8").trim();
	} catch (e) {
	}

	if (jsonVersionFileContent) {
		let versionData: any;
		try {
			versionData = JSON.parse(jsonVersionFileContent);
		} catch (e) {
			logger.error(`${jsonVersionFile} existed, but could not be parsed as JSON (${e}): ${jsonVersionFileContent}, falling back to legacy file`);
		}

		if (versionData) {
			const flutterVersion = versionData.flutterVersion;
			if (typeof flutterVersion === "string") {
				const validVersion = nullToUndefined(semver.valid(flutterVersion));
				if (validVersion) {
					return validVersion;
				} else {
					logger.error(`${jsonVersionFile} did not contain a valid "flutterVersion": ${jsonVersionFileContent}, falling back to legacy file`);
				}
			} else {
				logger.error(`${jsonVersionFile} did not contain a "flutterVersion": ${jsonVersionFileContent}, falling back to legacy file`);
			}
		}
	}

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

export function getPubGeneratorVersion(
	logger: Logger,
	packageMapPath: string,
	existsSync: (itemPath: string) => boolean,
	readFileSync: (itemPath: string) => string,
): string | undefined {
	if (!existsSync(packageMapPath))
		return undefined;
	try {
		const content = readFileSync(packageMapPath);
		const data = JSON.parse(content);
		const version = data.generatorVersion as string | undefined | null;
		return nullToUndefined(semver.valid(version));
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

export function createFolderForFile(file?: string): string | undefined {
	try {
		if (!file || !path.isAbsolute(file))
			return undefined;

		// Skip creation of paths with variables, we'll rely on them
		// being created after resolving.
		if (file?.includes("${")) {
			return file;
		}

		const folder = path.dirname(file);
		if (!fs.existsSync(folder))
			mkDirRecursive(folder);

		return file;
	} catch {
		console.warn(`Ignoring invalid file path ${file}`);
		return undefined;
	}
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
export function nextAvailableFilename(folder: string, prefix: string, suffix = ""): string {
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
