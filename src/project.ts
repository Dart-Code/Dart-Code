"use strict";

import * as fs from "fs";
import * as path from "path";
import * as vs from "vscode";
import * as util from "./utils";

export function locateBestProjectRoot(folder: string): string {
	if (!folder)
		return null;

	let editor = vs.window.activeTextEditor;
	if (!editor)
		return folder;

	if (!util.isWithinRootPath(editor.document.fileName))
		return folder;

	let dir = path.dirname(editor.document.fileName);
	while (dir != folder && dir.length > 1) {
		// TODO: existsSync is deprecated. 
		if (fs.existsSync(path.join(dir, "pubspec.yaml")))
			return dir;
		dir = path.dirname(dir);
	}

	return folder;
}
