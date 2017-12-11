"use strict";

import * as fs from "fs";
import * as path from "path";
import * as vs from "vscode";
import * as util from "./utils";

export function locateBestProjectRoot(folder: string): string {
	if (!folder || !util.isWithinWorkspace(folder))
		return null;

	let dir = folder;
	while (dir.length > 1) {
		if (fs.existsSync(path.join(dir, "pubspec.yaml")))
			return dir;
		dir = path.dirname(dir);
	}

	return null;
}
