import * as fs from "fs";
import * as path from "path";
import * as util from "./utils";

export const UPGRADE_TO_WORKSPACE_FOLDERS = "Mark Projects as Workspace Folders";

export function locateBestProjectRoot(folder: string): string | undefined {
	if (!folder || !util.isWithinWorkspace(folder))
		return undefined;

	let dir = folder;
	while (dir !== path.dirname(dir)) {
		if (fs.existsSync(path.join(dir, "pubspec.yaml")) || fs.existsSync(path.join(dir, ".packages")))
			return dir;
		dir = path.dirname(dir);
	}

	return undefined;
}

function getChildProjects(folder: string, levelsToGo: number): string[] {
	const children = fs
		.readdirSync(folder)
		.filter((f) => f !== "bin") // Don't look in bin folders
		.filter((f) => f !== "cache") // Don't look in cache folders
		.map((f) => path.join(folder, f))
		.filter((d) => fs.statSync(d).isDirectory());

	let projects: string[] = [];
	for (const dir of children) {
		if (fs.existsSync(path.join(dir, "pubspec.yaml"))) {
			projects.push(dir);
		}
		if (levelsToGo > 0)
			projects = projects.concat(getChildProjects(dir, levelsToGo - 1));
	}

	return projects;
}
