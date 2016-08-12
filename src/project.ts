"use strict";

import * as fs from "fs";
import * as path from "path";
import * as vs from "vscode";
import * as util from "./utils";

export function locateBestProjectRoot(): string {
	let root = vs.workspace.rootPath;
	if (!root)
		return null;

	let editor = vs.window.activeTextEditor;
	if (!editor)
		return root;

	if (!util.isWithinRootPath(editor.document))
		return root;

	let dir = path.dirname(editor.document.fileName);
	while (dir != root && dir.length > 1) {
		// TODO: existsSync is deprecated. 
		if (fs.existsSync(path.join(dir, "pubspec.yaml")))
			return dir;
		dir = path.dirname(dir);
	}

	return root;
}
