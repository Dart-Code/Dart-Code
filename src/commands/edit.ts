"use strict";

import * as as from "../analysis/analysis_server_types";
import * as editors from "../editors";
import * as vs from "vscode";
import { Analyzer } from "../analysis/analyzer";

export class EditCommands implements vs.Disposable {
	private context: vs.ExtensionContext;
	private analyzer: Analyzer;
	private commands: Array<vs.Disposable> = [];

	constructor(context: vs.ExtensionContext, analyzer: Analyzer) {
		this.context = context;
		this.analyzer = analyzer;

		this.commands.push(
			vs.commands.registerTextEditorCommand("dart.organizeDirectives", this.organizeDirectives, this),
			vs.commands.registerTextEditorCommand("dart.sortMembers", this.sortMembers, this),
			vs.commands.registerCommand("_dart.applySourceChange", this.applyEdits, this)
		);
	}

	private organizeDirectives(editor: vs.TextEditor, editBuilder: vs.TextEditorEdit) {
		this.sendEdit(this.analyzer.editOrganizeDirectives, "Organize Directives", editor, editBuilder);
	}

	private sortMembers(editor: vs.TextEditor, editBuilder: vs.TextEditorEdit) {
		this.sendEdit(this.analyzer.editSortMembers, "Sort Members", editor, editBuilder);
	}

	private sendEdit(f: (a: { file: string }) => Thenable<{edit: as.SourceFileEdit}>, commandName: string, editor: vs.TextEditor, editBuilder: vs.TextEditorEdit) {
		if (!editors.hasActiveDartEditor()) {
			vs.window.showWarningMessage("No active Dart editor.");
			return;
		}

		f = f.bind(this.analyzer); // Yay JavaScript!

		f({ file: editor.document.fileName }).then((response) => {
			let edit: as.SourceFileEdit = response.edit;
			if (edit.edits.length == 0)
				return;

			editor.edit((editBuilder: vs.TextEditorEdit) => {
				edit.edits.forEach((edit) => {
					let range = new vs.Range(
						editor.document.positionAt(edit.offset),
						editor.document.positionAt(edit.offset + edit.length)
					);
					editBuilder.replace(range, edit.replacement);
				});
			}).then((result) => {
				if (!result)
					vs.window.showWarningMessage(`Unable to apply ${commandName} edits.`);
			});
		}, (error) => {
			vs.window.showErrorMessage(`Error running ${commandName}: ${error.message}.`);
		});
	}

	dispose(): any {
		for (let command of this.commands)
			command.dispose();
	}

	private applyEdits(document: vs.TextDocument, change: as.SourceChange) {
		let changes = new vs.WorkspaceEdit();

		change.edits.forEach(edit => {
			edit.edits.forEach(e => {
				changes.replace(
					vs.Uri.file(edit.file),
					new vs.Range(
						document.positionAt(e.offset),
						document.positionAt(e.offset + e.length)
					),
					e.replacement
				)
			})
		});

		// Apply the edits.		
		vs.workspace.applyEdit(changes).then(success => {
			// Set the cursor position.
			if (change.selection) {
				let pos = document.positionAt(change.selection.offset);
				let selection = new vs.Selection(pos, pos);
				vs.window.showTextDocument(document).then(ed => ed.selection = selection);
			}
		});
	}
}
