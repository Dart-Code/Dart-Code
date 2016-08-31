"use strict";

import * as vs from "vscode";
import * as path from "path";
import { config } from "./config";

export class DartIndentFixer {
	onDidChangeActiveTextEditor(editor: vs.TextEditor) {
		if (!(editor && editor.document))
			return;

		let isDart = editor.document.languageId === "dart";
		let isPubspec = editor.document.languageId === "yaml" && path.basename(editor.document.fileName).toLowerCase() == "pubspec.yaml";
		let isAnalysisOptions = editor.document.languageId === "yaml" && path.basename(editor.document.fileName).toLowerCase() == "analysis_options.yaml";
		if (config.setIndentation && (isDart || isPubspec || isAnalysisOptions)) {
			editor.options = {
				insertSpaces: true,
				tabSize: 2
			};
		}
	}
}
