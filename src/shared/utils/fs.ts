import * as fs from "fs";
import * as path from "path";
import { FLUTTER_CREATE_PROJECT_TRIGGER_FILE, isWin } from "../constants";
import { Logger } from "../interfaces";
import { flatMapAsync } from "../utils";
import { sortBy } from "./array";

export function fsPath(uri: { fsPath: string } | string) {
	// tslint:disable-next-line:disallow-fspath
	return forceWindowsDriveLetterToUppercase(typeof uri === "string" ? uri : uri.fsPath);
}

export function forceWindowsDriveLetterToUppercase(p: string): string {
	if (p && isWin && path.isAbsolute(p) && p.startsWith(p.charAt(0).toLowerCase()))
		p = p.substr(0, 1).toUpperCase() + p.substr(1);
	return p;
}

export function isWithinPath(file: string, folder: string) {
	const relative = path.relative(folder, file);
	return !!relative && !relative.startsWith("..") && !path.isAbsolute(relative);
}

export function isEqualOrWithinPath(file: string, folder: string) {
	const relative = path.relative(folder, file);
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

export function hasPackagesFile(folder: string): boolean {
	return fs.existsSync(path.join(folder, ".packages"));
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

async function fileExists(p: string): Promise<boolean> {
	try {
		await fs.promises.access(p);
		return true;
	} catch {
		return false;
	}
}

// Walks a few levels down and returns all folders that look like project
// folders, such as:
// - have a pubspec.yaml
// - have a project create trigger file
// - are the Flutter repo root
export async function findProjectFolders(logger: Logger, roots: string[], excludedFolders: string[], options: { sort?: boolean; requirePubspec?: boolean } = {}): Promise<string[]> {
	const dartToolFolderName = `${path.sep}.dart_tool${path.sep}`;

	const level2Folders = await flatMapAsync(roots, (f) => getChildFolders(logger, f));
	const level3Folders = await flatMapAsync(level2Folders, (f) => getChildFolders(logger, f));
	const allPossibleFolders = roots.concat(level2Folders).concat(level3Folders)
		.filter((f) => !f.includes(dartToolFolderName) && excludedFolders.every((ef) => !isEqualOrWithinPath(f, ef)));

	const projectFolderPromises = allPossibleFolders.map(async (folder) => ({
		exists: options && options.requirePubspec
			? await hasPubspecAsync(folder)
			: await hasPubspecAsync(folder) || await hasCreateTriggerFileAsync(folder) || await isFlutterRepoAsync(folder),
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
