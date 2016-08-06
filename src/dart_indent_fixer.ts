"use strict";

import * as vscode from "vscode";
import * as util from "./utils";

const configSetIndentName = "setIndentSettings";

export class DartIndentFixer {
	onDidChangeActiveTextEditor(editor: vscode.TextEditor) {
		if (editor && editor.document.languageId === 'dart' && util.getConfig<boolean>(configSetIndentName)) {
			editor.options = {
				insertSpaces: true,
				tabSize: 2
			};
		}
	}
}
