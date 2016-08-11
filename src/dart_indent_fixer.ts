"use strict";

import * as vs from "vscode";
import { config } from "./config";

export class DartIndentFixer {
	onDidChangeActiveTextEditor(editor: vs.TextEditor) {
		if (editor && editor.document.languageId === "dart" && config.setIndentation) {
			editor.options = {
				insertSpaces: true,
				tabSize: 2
			};
		}
	}
}
