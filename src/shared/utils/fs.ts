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
import { notUndefined, nullToUndefined } from "../utils";
import { sortBy } from "./array";
import { mapWithConcurrency } from "./promises";

export function fsPath(uri: URI, { useRealCasing = false }: { useRealCasing?: boolean; } = {}): string {
	// eslint-disable-next-line no-restricted-properties
	let newPath = typeof uri === "string" ? uri : uri.fsPath;

	// Fix drive letter first, so we won't write warnings if that's the only difference.
	newPath = forceWindowsDriveLetterToUppercase(newPath);

	if (useRealCasing) {
		const realPath = fs.existsSync(newPath) && safeRealpathSync(newPath, { useNative: true });
		// Since realpathSync.native will resolve symlinks, only do anything if the paths differ
		// _only_ by case.
		// when there was no symlink (eg. the lowercase version of both paths match).
		if (realPath && realPath.toLowerCase() === newPath.toLowerCase() && realPath !== newPath) {
			console.warn(`Rewriting path:\n  ${newPath}\nto:\n  ${realPath} because the casing appears incorrect`);
			newPath = realPath;
		}
	}

	return newPath;
}

export function safeRealpathSync(filePath: string, { useNative = false }: { useNative?: boolean; } = {}): string {
	try {
		return useNative
			? fs.realpathSync.native(filePath)
			: fs.realpathSync(filePath);
	} catch {
		return filePath;
	}
}

export function forceWindowsDriveLetterToUppercase<T extends string | undefined>(p: T): string | (undefined extends T ? undefined : never) {
	if (typeof p !== "string")
		return undefined as (undefined extends T ? undefined : never);

	const pathModule = isWin ? path.win32 : path;
	if (p && isWin && pathModule.isAbsolute(p) && p.startsWith(p.charAt(0).toLowerCase()))
		return p.substr(0, 1).toUpperCase() + p.substr(1);

	return p;
}

export function forceWindowsDriveLetterToUppercaseInUriString<T extends string | undefined>(uriString: T): string | (undefined extends T ? undefined : never) {
	if (typeof uriString !== "string")
		return undefined as (undefined extends T ? undefined : never);

	return uriString.replace(/^([\w+-.]+):(\/\/\w*)?\/(\w)(:|%3A)\//, (match: string, scheme: string, authority: string | undefined, driveLetter: string, colon: string) => `${scheme}:${authority ?? ""}/${driveLetter.toUpperCase()}${colon}/`);
}

/**
 * Returns a string for comparing URIs.
 *
 * For file URIs this will be `fsPath()` with a `file:` prefix (this will NOT be a valid URI).
 * On Windows, the string will be lowercased.
 *
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

/**
 * Returns the path to the `.dart-tool` directory in the user's home/AppData folder,
 * matching the path used by Dart/Flutter tooling in `package:unified_analytics` and `dartdev`
 * (`%APPDATA%\.dart-tool` on Windows and `$HOME/.dart-tool` on macOS/Linux):
 *
 * - https://github.com/dart-lang/tools/blob/1579f8d690d28e7e38adf469d35d31a573ed5132/pkgs/unified_analytics/lib/src/utils.dart#L137-L152
 * - https://github.com/dart-lang/sdk/blob/23be3944a2a425c8930059940e4f8df92369b3af/pkg/dartdev/lib/src/unified_analytics.dart#L163-L167
 */
export function getDartToolDir(env: NodeJS.ProcessEnv = process.env, platformIsWin = isWin): string | undefined {
	const baseDir = platformIsWin ? env.APPDATA : env.HOME;
	return baseDir ? path.join(baseDir, ".dart-tool") : undefined;
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
	const files = await readDirAsync(logger, parent);

	return files.filter((f) => f.isDirectory())
		.filter((f) => f.name !== "bin" || (options?.allowBin)) // Don't look in bin folders
		.filter((f) => f.name !== "cache" || (options?.allowCache)) // Don't look in cache folders
		.map((item) => path.join(parent, item.name));
}

async function readDirAsync(logger: Logger, folder: string): Promise<fs.Dirent[]> {
	try {
		return await fs.promises.readdir(folder, { withFileTypes: true });
	} catch (err: unknown) {
		// We will generate errors if we don't have access to this folder
		// so just skip over it (and ignore missing folders).
		if ((err as { code?: unknown } | undefined)?.code !== "ENOENT")
			logger.warn(`Skipping folder ${folder} due to error: ${String(err)}`);
		return [];
	}
}

function statSyncSafe(file: string): fs.Stats | undefined {
	try {
		return fs.statSync(file, { throwIfNoEntry: false });
	} catch {
		// Although I can't repro on any OS, some users see ENOTDIR if the path
		// looks like `/path/to/file.dart/foo` which is possible because of
		// how we call some of the helpers.
		return undefined;
	}
}

export function existsAndIsFileSync(file: string): boolean {
	const stat = statSyncSafe(file);
	return stat?.isFile() ?? false;
}

export function existsAndIsDirectorySync(file: string): boolean {
	const stat = statSyncSafe(file);
	return stat?.isDirectory() ?? false;
}

export async function existsAndIsFileAsync(file: string): Promise<boolean> {
	try {
		const stat = await fs.promises.stat(file);
		return stat?.isFile() ?? false;
	} catch {
		return false;
	}
}

export async function existsAndIsDirectoryAsync(file: string): Promise<boolean> {
	try {
		const stat = await fs.promises.stat(file);
		return stat?.isDirectory() ?? false;
	} catch {
		return false;
	}
}

export function hasPackageMapFile(folder: string): boolean {
	return existsAndIsFileSync(path.join(folder, ".dart_tool", "package_config.json"));
}

export function hasPubspec(folder: string): boolean {
	return existsAndIsFileSync(path.join(folder, "pubspec.yaml"));
}

/**
 * Checks whether `folder` looks like a Flutter SDK repository root.
 */
export function isFlutterRepo(folder: string): boolean {
	return existsAndIsDirectorySync(path.join(folder, "bin", "cache", "dart-sdk"))
		&& (existsAndIsFileSync(path.join(folder, "bin", "flutter"))
			|| (isWin && existsAndIsFileSync(path.join(folder, "bin", "flutter.bat"))));
}

export function isFlutterProjectFolder(folder?: string): boolean {
	return projectReferencesFlutter(folder);
}

/**
 * Reads `pubspec.yaml` in `folder`, returning `undefined` if it does not exist or cannot be read.
 */
export function tryReadPubspecContent(folder: string): string | undefined {
	const pubspecPath = path.join(folder, "pubspec.yaml");
	try {
		return fs.readFileSync(pubspecPath, "utf8");
	} catch (e: unknown) {
		const err = e as { code?: unknown } | undefined;
		if (err?.code !== "ENOENT" && err?.code !== "EISDIR" && err?.code !== "ENOTDIR") // Don't warn for missing files or directories.
			console.warn(`Failed to read ${pubspecPath}: ${String(e)}`);
		return undefined;
	}
}

export function projectReferencesFlutter(folder?: string): boolean {
	if (!folder)
		return false;
	const pubspecContent = tryReadPubspecContent(folder);
	return pubspecContent !== undefined && pubspecContentReferencesFlutter(pubspecContent);
}

export function pubspecContentReferencesFlutter(content: string): boolean {
	// Do a fast string check first, because YAML parse can be slow in comparison.
	if (!content.includes("flutter"))
		return false;
	try {
		const yaml = YAML.parse(content) as Record<string, Record<string, unknown> | undefined> | undefined;
		return !!yaml?.dependencies?.flutter
			|| !!yaml?.dev_dependencies?.flutter
			|| !!yaml?.dependencies?.sky_engine
			|| !!yaml?.dev_dependencies?.sky_engine
			|| !!yaml?.dependencies?.flutter_test
			|| !!yaml?.dev_dependencies?.flutter_test
			|| !!yaml?.dependencies?.flutter_goldens
			|| !!yaml?.dev_dependencies?.flutter_goldens;
	} catch {
		return false;
	}
}

export function tryGetPackageName(packageDirectory: string): string | undefined {
	const content = tryReadPubspecContent(packageDirectory);
	if (content === undefined)
		return undefined;
	try {
		const yaml = YAML.parse(content) as { name?: string } | undefined;
		return yaml?.name ?? undefined;
	} catch {
		return undefined;
	}
}

export function getPackageName(packageDirectory: string): string {
	return tryGetPackageName(packageDirectory) ?? path.basename(packageDirectory);
}

export function referencesBuildRunner(folder?: string): boolean {
	if (!folder)
		return false;
	const content = tryReadPubspecContent(folder);
	if (content === undefined)
		return false;
	const regex = new RegExp("build_runner\\s*:", "i");
	return regex.test(content);
}

export function extractFlutterSdkPathFromPackagesFile(projectFolder: string): string | undefined {
	if (!fs.existsSync(projectFolder))
		return undefined;

	const packageMap = PackageMap.loadForProject(nullLogger, projectFolder);
	const flutterRootPath = packageMap.flutterRootPath;
	let packagePath = flutterRootPath ?? packageMap.getPackagePath("flutter");

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
	if (!flutterRootPath && packagePath.endsWith(pathSuffix)) {
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

	return fs.existsSync(packagePath) ? packagePath : undefined;
}


export function resolveTildePaths<T extends string | undefined>(p: T): string | (undefined extends T ? undefined : never) {
	if (typeof p !== "string")
		return undefined as (undefined extends T ? undefined : never);

	if (p.startsWith("~/"))
		return path.join(os.homedir(), p.substr(2));

	return p;
}

/**
 * Maximum number of concurrent filesystem operations (`readdir`, `stat`, and `analysis_options.yaml` reads)
 * during project folder discovery. Bounded to 8 to speed up traversal without contending heavily with
 * VS Code startup or exhausting file descriptors (`EMFILE`) on platforms with low default limits.
 */
export const projectSearchConcurrency = 8;

// Subdirectories skipped during project discovery.
// Dot-prefixed directories (e.g. `.git`, `.dart_tool`, `.widget_preview`, `.gradle`, `.idea`, `.vscode`, `.fvm`)
// are skipped separately via `startsWith(".")`. `bin` and `cache` preserve the pre-existing `getChildFolders()`
// skips (e.g. avoiding `bin/cache/` inside Flutter SDK checkouts), and `node_modules` skips JS dependency trees.
const skippedProjectSearchFolders = new Set([
	"bin",
	"cache",
	"node_modules",
]);

/**
 * Metadata for a discovered project folder returned by `findProjectFoldersWithDetails()`.
 */
export interface FoundProjectFolder {
	folder: string;
	/**
	 * Whether `pubspec.yaml` was confirmed in `folder`:
	 * - `true`: `pubspec.yaml` exists in `folder`.
	 * - `false`: No `pubspec.yaml`, but matched as a project trigger (`flutter.create`) or Flutter SDK repo root when `requirePubspec` is false.
	 * - `undefined`: `pubspec.yaml` was not checked (e.g. `onlyWorkspaceRoots: true` with `requirePubspec: false`).
	 */
	hasPubspec?: boolean;
}

/**
 * Checks whether `fileName` exists as a file in `folder`, using cached `Dirent` entries when available
 * and falling back to an async `stat` for leaf folders (`entries === undefined`), symlinks, or
 * case-insensitive matches (e.g. `Pubspec.yaml` on Windows/macOS).
 */
async function folderHasFile(folder: string, entries: fs.Dirent[] | undefined, fileName: string): Promise<boolean> {
	if (!entries)
		return await existsAndIsFileAsync(path.join(folder, fileName));

	const exactMatch = entries.find((e) => e.name === fileName);
	if (exactMatch) {
		if (exactMatch.isFile())
			return true;
		if (exactMatch.isSymbolicLink())
			return await existsAndIsFileAsync(path.join(folder, fileName));
		return false;
	}

	// If a case-different entry exists (e.g. `Pubspec.yaml`), let the OS resolve the canonical filename
	// so case-insensitive filesystems match while case-sensitive filesystems still return false.
	const lowerFileName = fileName.toLowerCase();
	const caseInsensitiveMatch = entries.find((e) => e.name.toLowerCase() === lowerFileName);
	if (caseInsensitiveMatch && (caseInsensitiveMatch.isFile() || caseInsensitiveMatch.isSymbolicLink()))
		return await existsAndIsFileAsync(path.join(folder, fileName));

	return false;
}

/**
 * Checks whether `entries` contains a directory or symlink matching `dirName` (case-insensitively),
 * used as a cheap pre-filter before inspecting subdirectories.
 */
function hasDirectoryEntry(entries: fs.Dirent[], dirName: string): boolean {
	const lowerDirName = dirName.toLowerCase();
	const entry = entries.find((e) => e.name.toLowerCase() === lowerDirName);
	return !!entry && (entry.isDirectory() || entry.isSymbolicLink());
}

/**
 * Walks up to `searchDepth` levels from `roots` and returns all folders that look like project
 * folders, along with whether each has a `pubspec.yaml` when checked.
 */
export async function findProjectFoldersWithDetails(
	logger: Logger,
	roots: string[],
	excludedFolders: string[],
	options: { sort?: boolean; requirePubspec?: boolean, searchDepth: number, onlyWorkspaceRoots?: boolean },
	token: MyCancellationToken,
): Promise<FoundProjectFolder[]> {
	const rootSet = new Set<string>(roots);
	const isExcluded = (folder: string) => excludedFolders.some((ef) => isWithinPathOrEqual(folder, ef));

	interface CandidateFolder {
		folder: string;
		entries?: fs.Dirent[];
	}

	let currentLevel: CandidateFolder[] = [...rootSet].filter((f) => !isExcluded(f)).map((folder) => ({ folder }));
	const allCandidates: CandidateFolder[] = [...currentLevel];
	// Start at 1, as we already added the roots.
	const searchDepth = options.onlyWorkspaceRoots ? 1 : options.searchDepth;
	for (let i = 1; i < searchDepth; i++) {
		if (token.isCancellationRequested || !currentLevel.length)
			break;

		const childrenPerParent = await mapWithConcurrency(currentLevel, projectSearchConcurrency, async (candidate): Promise<CandidateFolder[]> => {
			if (token.isCancellationRequested)
				return [];

			const entries = await readDirAsync(logger, candidate.folder);
			// Store the unfiltered entries before pruning subdirectories like "bin" so project checks can still inspect them.
			candidate.entries = entries;

			const children: CandidateFolder[] = [];
			for (const entry of entries) {
				if (!entry.isDirectory())
					continue;
				// Filter by child folder name only so hidden/skipped ancestors above a workspace root are never excluded.
				if (entry.name.startsWith(".") || skippedProjectSearchFolders.has(entry.name))
					continue;

				const childPath = path.join(candidate.folder, entry.name);
				if (rootSet.has(childPath) || isExcluded(childPath))
					continue;

				// Skip generated `build/` output folders, but keep real source packages named `build` (e.g. `dart-lang/build`).
				if (entry.name === "build" && !(await existsAndIsFileAsync(path.join(childPath, "pubspec.yaml"))))
					continue;

				children.push({ folder: childPath });
			}
			return children;
		});

		const nextLevel: CandidateFolder[] = [];
		for (const children of childrenPerParent) {
			for (const child of children) {
				nextLevel.push(child);
				allCandidates.push(child);
			}
		}
		currentLevel = nextLevel;
	}

	const checkedProjects = await mapWithConcurrency(allCandidates, projectSearchConcurrency, async ({ folder, entries }): Promise<FoundProjectFolder | undefined> => {
		// If cancelled, skip un-enumerated candidates (avoiding extra leaf stat I/O),
		// while still checking already-enumerated shallow folders/roots so mid-traversal
		// cancellation does not discard known workspace projects.
		if (token.isCancellationRequested && !entries)
			return undefined;

		if (options.onlyWorkspaceRoots && !options.requirePubspec)
			return { folder, hasPubspec: undefined };

		// `entries` is populated for traversed non-leaf folders and `undefined` for leaf folders
		// at `searchDepth` (where we intentionally avoided `readdir` and fall back to stat).
		if (await folderHasFile(folder, entries, "pubspec.yaml"))
			return { folder, hasPubspec: true };
		if (options.requirePubspec)
			return undefined;

		if (await folderHasFile(folder, entries, FLUTTER_CREATE_PROJECT_TRIGGER_FILE))
			return { folder, hasPubspec: false };

		if ((!entries || hasDirectoryEntry(entries, "bin")) && isFlutterRepo(folder))
			return { folder, hasPubspec: false };

		return undefined;
	});

	const projectFolders = checkedProjects.filter(notUndefined);

	return options?.sort
		? sortBy(projectFolders, (p) => p.folder.toLowerCase())
		: projectFolders;
}

// Walks a few levels down and returns all folders that look like project
// folders, such as:
// - have a pubspec.yaml
// - have a project create trigger file
// - are the Flutter repo root
export async function findProjectFolders(logger: Logger, roots: string[], excludedFolders: string[], options: { sort?: boolean; requirePubspec?: boolean, searchDepth: number, onlyWorkspaceRoots?: boolean }, token: MyCancellationToken): Promise<string[]> {
	const results = await findProjectFoldersWithDetails(logger, roots, excludedFolders, options, token);
	return results.map((r) => r.folder);
}

export function getSdkVersion(logger: Logger, { sdkRoot, isFlutter = true }: { sdkRoot?: string; isFlutter?: boolean }): string | undefined {
	if (!sdkRoot)
		return undefined;

	if (isFlutter) {
		// Try to read the new JSON file for Flutter. Don't use exist checks as it races,
		// just try to read and see if we get contents.
		const jsonVersionFile = path.join(sdkRoot, "bin", "cache", "flutter.version.json");
		let jsonVersionFileContent: string | undefined;
		try {
			jsonVersionFileContent = fs.readFileSync(jsonVersionFile, "utf8").trim();
		} catch {
		}

		if (jsonVersionFileContent) {
			let versionData: { flutterVersion?: unknown } | undefined;
			try {
				versionData = JSON.parse(jsonVersionFileContent) as { flutterVersion?: unknown } | undefined;
			} catch (e) {
				logger.error(`${jsonVersionFile} existed, but could not be parsed as JSON (${String(e)}): ${jsonVersionFileContent}, falling back to legacy file`);
			}

			if (versionData) {
				const flutterVersion = versionData.flutterVersion;
				if (typeof flutterVersion === "string") {
					const validVersion = nullToUndefined(semver.valid(flutterVersion));
					if (validVersion)
						return validVersion;
					else
						logger.error(`${jsonVersionFile} did not contain a valid "flutterVersion": ${jsonVersionFileContent}, falling back to legacy file`);
				} else {
					logger.error(`${jsonVersionFile} did not contain a "flutterVersion": ${jsonVersionFileContent}, falling back to legacy file`);
				}
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

export function tryDeleteFile(filePath: string) {
	if (fs.existsSync(filePath)) {
		try {
			fs.unlinkSync(filePath);
		} catch (e: unknown) {
			console.warn(`Failed to delete file ${filePath}: ${String(e)}`);
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

// Matches a file path ending with a non-dot/non-separator character followed by a 3 or 4 character
// alphanumeric extension (e.g. `.txt` or `.log`).
// IMPORTANT: This pattern is duplicated in `package.json` for `dart.*LogFile` settings and must be kept in sync.
export const validLogFilePattern = /[^.\\/]\.[a-zA-Z0-9]{3,4}$/;

/**
 * Validates that a configured log file path is an absolute file path (with a 3 or 4 character
 * extension and not pointing to an existing directory on disk) before creating its parent folder.
 *
 * This prevents partially-typed paths or folder paths (for example when editing `settings.json`
 * with Auto Save enabled) from creating intermediate folders or being passed to tools/streams
 * that expect a file path.
 */
export function prepareLogFilePath(file?: string): string | undefined {
	if (!file || !path.isAbsolute(file) || !validLogFilePattern.test(file) || existsAndIsDirectorySync(file))
		return undefined;

	return createFolderForFile(file);
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
		if (!fs.existsSync(folder)) {
			mkDirRecursive(folder);
		} else if (!existsAndIsDirectorySync(folder)) {
			// The parent path exists on disk as a file rather than a directory (for example if an
			// earlier path created a file at `folder`), so `file` cannot be created inside it.
			return undefined;
		}

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
	return p.replace(/[\\/]/g, isWin ? path.win32.sep : path.sep);
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

/// Updates the modification time of a file to the current time (if the file exists).
export function touchFile(filePath: string): void {
	try {
		if (fs.existsSync(filePath)) {
			const now = new Date();
			fs.utimesSync(filePath, now, now);
		}
	} catch {
		// Silently ignore errors (file doesn't exist, permission issues).
	}
}
