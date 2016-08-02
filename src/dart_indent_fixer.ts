"use strict";

import * as vscode from "vscode";

export class DartIndentFixer {
	private enabledCheck: () => boolean;
	constructor(enabledCheck: () => boolean) {
		this.enabledCheck = enabledCheck;
	}

	onDidChangeActiveTextEditor(editor: vscode.TextEditor) {
		if (editor && editor.document.languageId === 'dart' && this.enabledCheck()) {
			editor.options = {
				insertSpaces: true,
				tabSize: 2
			};
		}
	}
}
