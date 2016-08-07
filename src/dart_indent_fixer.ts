"use strict";

import * as vscode from "vscode";
import { config } from "./config";

export class DartIndentFixer {
	onDidChangeActiveTextEditor(editor: vscode.TextEditor) {
		if (editor && editor.document.languageId === 'dart' && config.setIndentation) {
			editor.options = {
				insertSpaces: true,
				tabSize: 2
			};
		}
	}
}
