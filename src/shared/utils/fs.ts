import * as fs from "fs";
import * as glob from "glob";
import * as path from "path";
import { FLUTTER_CREATE_PROJECT_TRIGGER_FILE, FLUTTER_STAGEHAND_PROJECT_TRIGGER_FILE } from "../constants";
import { flatMap } from "../utils";
import { sortBy } from "./array";

export function getChildFolders(parent: string, options?: { allowBin?: boolean, allowCache?: boolean }): string[] {
	if (!fs.existsSync(parent))
		return [];
	return fs.readdirSync(parent)
		.filter((f) => f !== "bin" || (options && options.allowBin)) // Don't look in bin folders
		.filter((f) => f !== "cache" || (options && options.allowCache)) // Don't look in cache folders
		.map((item) => path.join(parent, item))
		.filter((item) => fs.existsSync(item) && fs.statSync(item).isDirectory());
}

export function hasPackagesFile(folder: string): boolean {
	return fs.existsSync(path.join(folder, ".packages"));
}

export function hasPubspec(folder: string): boolean {
	return fs.existsSync(path.join(folder, "pubspec.yaml"));
}

export function hasCreateTriggerFile(folder: string): boolean {
	return fs.existsSync(path.join(folder, FLUTTER_CREATE_PROJECT_TRIGGER_FILE))
		|| fs.existsSync(path.join(folder, FLUTTER_STAGEHAND_PROJECT_TRIGGER_FILE));
}

export function isFlutterRepo(folder: string): boolean {
	return fs.existsSync(path.join(folder, "bin/flutter")) && fs.existsSync(path.join(folder, "bin/cache/dart-sdk"));
}

// Walks a few levels down and returns all folders that look like project
// folders, such as:
// - have a pubspec.yaml
// - have a project create trigger file
// - are the Flutter repo root
export function findProjectFolders(roots: string[], options: { sort?: boolean, requirePubspec?: boolean } = {}): string[] {
	const level2Folders = flatMap(roots, getChildFolders);
	const level3Folders = flatMap(level2Folders, getChildFolders);
	const allPossibleFolders = roots.concat(level2Folders).concat(level3Folders);

	const projectFolders = allPossibleFolders.filter((f) => {
		return options && options.requirePubspec
			? hasPubspec(f)
			: hasPubspec(f) || hasCreateTriggerFile(f) || isFlutterRepo(f);
	});
	return options && options.sort
		? sortBy(projectFolders, (p) => p.toLowerCase())
		: projectFolders;
}

export function tryDeleteFile(filePath: string) {
	if (fs.existsSync(filePath)) {
		try {
			fs.unlinkSync(filePath);
		} catch {
			console.warn(`Failed to delete file $path.`);
		}
	}
}

// Takes a path and resolves it to the real casing as it exists on the file
// system. Copied from https://stackoverflow.com/a/33139702.
export function trueCasePathSync(fsPath: string): string {
	// Normalize the path so as to resolve . and .. components.
	// !! As of Node v4.1.1, a path starting with ../ is NOT resolved relative
	// !! to the current dir, and glob.sync() below then fails.
	// !! When in doubt, resolve with fs.realPathSync() *beforehand*.
	let fsPathNormalized = path.normalize(fsPath);

	// OSX: HFS+ stores filenames in NFD (decomposed normal form) Unicode format,
	// so we must ensure that the input path is in that format first.
	if (process.platform === "darwin")
		fsPathNormalized = fsPathNormalized.normalize("NFD");

	// !! Windows: Curiously, the drive component mustn't be part of a glob,
	// !! otherwise glob.sync() will invariably match nothing.
	// !! Thus, we remove the drive component and instead pass it in as the 'cwd'
	// !! (working dir.) property below.
	const pathRoot = path.parse(fsPathNormalized).root;
	const noDrivePath = fsPathNormalized.slice(Math.max(pathRoot.length - 1, 0));

	// Perform case-insensitive globbing (on Windows, relative to the drive /
	// network share) and return the 1st match, if any.
	// Fortunately, glob() with nocase case-corrects the input even if it is
	// a *literal* path.
	return glob.sync(noDrivePath, { nocase: true, cwd: pathRoot })[0];
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
