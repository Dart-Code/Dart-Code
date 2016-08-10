'use strict';

import * as fs from 'fs';
import * as path from 'path';
import * as vs from 'vscode';

export function locateBestProjectRoot(): string {
	let root = vs.workspace.rootPath;
	if (!root)
		return null;

	let editor = vs.window.activeTextEditor;
	if (!editor)
		return root;

	let file = editor.document.fileName;
	if (editor.document.isUntitled || !file)
		return root;

	// Make sure the current file is under the root.
	if (!file.startsWith(root))
		return root;

	let dir = path.dirname(file);
	while (dir != root && dir.length > 1) {
		if (fs.existsSync(path.join(dir, 'pubspec.yaml')))
			return dir;
		dir = path.dirname(dir);
	}

	return root;
}
