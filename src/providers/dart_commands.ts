"use strict";

import * as as from "../analysis/analysis_server_types";
import * as editors from "../editors";
import * as vs from "vscode";
import { Analyzer } from "../analysis/analyzer";

export class DartCommands  {
	private analyzer: Analyzer;
	constructor(context: vs.ExtensionContext, analyzer: Analyzer) {
		this.analyzer = analyzer;

        context.subscriptions.push(
            vs.commands.registerTextEditorCommand("dart.organizeDirectives", this.organizeDirectives, this)
        );
	}

    organizeDirectives(editor: vs.TextEditor, editBuilder: vs.TextEditorEdit) {
        if (!editors.hasActiveDartEditor()) {
            vs.window.showWarningMessage("No active Dart editor.");
            return;
        }

        this.analyzer.editOrganizeDirectives({ file: editor.document.fileName }).then((response) => {
            let edit: as.SourceFileEdit = response.edit;
			if (edit.edits.length == 0) {
                vs.window.showInformationMessage("No changes from organize directives.");
                return;
            }

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
                    vs.window.showWarningMessage("Unable to apply organize directives edits.");
            });
        }, (error) => {
            vs.window.showErrorMessage(`Error running organize directives: ${error}.`);
        });
    }
}
