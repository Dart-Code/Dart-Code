import * as fs from "fs";
import * as path from "path";

export function getChildFolders(parent: string): string[] {
	if (!fs.existsSync(parent))
		return [];
	return fs.readdirSync(parent)
		.map((item) => path.join(parent, item))
		.filter((item) => fs.existsSync(item) && fs.statSync(item).isDirectory());
}

export function hasPackagesFile(folder: string): boolean {
	return fs.existsSync(path.join(folder, ".packages"));
}

export function hasPubspec(folder: string): boolean {
	return fs.existsSync(path.join(folder, "pubspec.yaml"));
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
