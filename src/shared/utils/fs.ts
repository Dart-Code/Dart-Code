import * as fs from "fs";
import * as path from "path";
import { FLUTTER_CREATE_PROJECT_TRIGGER_FILE, FLUTTER_STAGEHAND_PROJECT_TRIGGER_FILE } from "../constants";
import { flatMap } from "../utils";
import { sortBy } from "./array";

export function getChildFolders(parent: string, options?: { allowBin?: boolean, allowCache?: boolean }): string[] {
	if (!fs.existsSync(parent))
		return [];
	return fs.readdirSync(parent, { withFileTypes: true })
		.filter((f) => f.isDirectory())
		.filter((f) => f.name !== "bin" || (options && options.allowBin)) // Don't look in bin folders
		.filter((f) => f.name !== "cache" || (options && options.allowCache)) // Don't look in cache folders
		.map((item) => path.join(parent, item.name));
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
