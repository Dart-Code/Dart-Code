import * as fs from "fs";
import * as path from "path";

export function getChildFolders(parent: string): string[] {
	return fs.readdirSync(parent)
		.map((item) => path.join(parent, item))
		.filter((item) => fs.statSync(item).isDirectory());
}

export function hasPackagesFile(folder: string): boolean {
	return fs.existsSync(path.join(folder, ".packages"));
}

export function hasPubspec(folder: string): boolean {
	return fs.existsSync(path.join(folder, "pubspec.yaml"));
}
