import * as as from "../analysis/analysis_server_types";
import * as editors from "../editors";
import * as vs from "vscode";
import { Analyzer } from "../analysis/analyzer";

export class EditCommands implements vs.Disposable {
	private context: vs.ExtensionContext;
	private analyzer: Analyzer;
	private commands: vs.Disposable[] = [];

	constructor(context: vs.ExtensionContext, analyzer: Analyzer) {
		this.context = context;
		this.analyzer = analyzer;

		this.commands.push(
			vs.commands.registerTextEditorCommand("dart.organizeDirectives", this.organizeDirectives, this),
			vs.commands.registerTextEditorCommand("dart.sortMembers", this.sortMembers, this),
			vs.commands.registerCommand("_dart.applySourceChange", this.applyEdits, this),
		);
	}

	private organizeDirectives(editor: vs.TextEditor, editBuilder: vs.TextEditorEdit): Thenable<void> {
		return this.sendEdit(this.analyzer.editOrganizeDirectives, "Organize Directives", editor, editBuilder);
	}

	private sortMembers(editor: vs.TextEditor, editBuilder: vs.TextEditorEdit): Thenable<void> {
		return this.sendEdit(this.analyzer.editSortMembers, "Sort Members", editor, editBuilder);
	}

	private async sendEdit(f: (a: { file: string }) => Thenable<{ edit: as.SourceFileEdit }>, commandName: string, editor: vs.TextEditor, editBuilder: vs.TextEditorEdit): Promise<void> {
		if (!editors.hasActiveDartEditor()) {
			vs.window.showWarningMessage("No active Dart editor.");
			return;
		}

		f = f.bind(this.analyzer); // Yay JavaScript!

		try {
			const response = await f({ file: editor.document.fileName });

			const edit: as.SourceFileEdit = response.edit;
			if (edit.edits.length === 0)
				return;

			// TODO: Should we be calling editor.edit when we already have an editBuilder?
			const result = await editor.edit((editBuilder: vs.TextEditorEdit) => {
				edit.edits.forEach((edit) => {
					const range = new vs.Range(
						editor.document.positionAt(edit.offset),
						editor.document.positionAt(edit.offset + edit.length),
					);
					editBuilder.replace(range, edit.replacement);
				});
			});

			if (!result)
				vs.window.showWarningMessage(`Unable to apply ${commandName} edits.`);
		} catch (error) {
			vs.window.showErrorMessage(`Error running ${commandName}: ${error.message}.`);
		}
	}

	public dispose(): any {
		for (const command of this.commands)
			command.dispose();
	}

	private applyEdits(document: vs.TextDocument, change: as.SourceChange) {
		// We can only apply with snippets if there's a single change.
		if (change.edits.length === 1 && change.linkedEditGroups != null && change.linkedEditGroups.length !== 0)
			return this.applyEditsWithSnippets(document, change);

		// Otherwise, just make all the edits without the snippets.
		const changes = new vs.WorkspaceEdit();

		change.edits.forEach((edit) => {
			edit.edits.forEach((e) => {
				changes.replace(
					vs.Uri.file(edit.file),
					new vs.Range(
						// TODO: This is the wrong document and may do the wrong thing for multi-file edits.
						document.positionAt(e.offset),
						document.positionAt(e.offset + e.length),
					),
					e.replacement,
				);
			});
		});

		// Apply the edits.
		vs.workspace.applyEdit(changes).then((success) => {
			// Set the cursor position.
			if (change.selection) {
				const pos = document.positionAt(change.selection.offset);
				const selection = new vs.Selection(pos, pos);
				vs.window.showTextDocument(document).then((ed) => ed.selection = selection);
			}
		});
	}

	private applyEditsWithSnippets(document: vs.TextDocument, change: as.SourceChange) {
		const edit = change.edits[0];
		vs.window.showTextDocument(document).then((editor) => {
			// Apply of all of the edits.
			editor.edit((eb) => {
				edit.edits.forEach((e) => {
					eb.replace(
						new vs.Range(document.positionAt(e.offset), document.positionAt(e.offset + e.length)),
						e.replacement,
					);
				});
			}).then((_) => {
				const documentText = editor.document.getText();

				// Create a list of all the placeholders.
				const placeholders: Array<{ offset: number, length: number, defaultValue: string, choices?: string[], placeholderNumber: number }> = [];
				let placeholderNumber = 1;
				change.linkedEditGroups.forEach((leg) => {
					leg.positions.forEach((pos) => {
						const defaultValue = documentText.substr(pos.offset, leg.length);
						const choices = leg.suggestions ? leg.suggestions.map((s) => s.value) : null;
						placeholders.push({ offset: pos.offset, length: leg.length, defaultValue, choices, placeholderNumber });
					});
					placeholderNumber++;
				});

				// Ensure they're in offset order so the next maths works!
				placeholders.sort((p1, p2) => p1.offset - p2.offset);

				const snippet = new vs.SnippetString();
				const firstPlaceholder = placeholders[0];
				const lastPlaceholder = placeholders[placeholders.length - 1];
				const startPos = firstPlaceholder.offset;
				const endPos = lastPlaceholder.offset + lastPlaceholder.length;
				let currentPos = startPos;
				placeholders.forEach((p) => {
					// Add the text from where we last were up to current placeholder.
					if (currentPos !== p.offset)
						snippet.appendText(documentText.substring(currentPos, p.offset));
					// Add the choices / placeholder.
					// Uncomment for https://github.com/Dart-Code/Dart-Code/issues/569 when there's an API we can use
					if (p.choices && p.choices.length > 1)
						snippet.appendText("").value += "${" + p.placeholderNumber + "|" + p.choices.map((c) => this.snippetStringEscape(c)).join(",") + "|}";
					else
						snippet.appendPlaceholder(p.defaultValue, p.placeholderNumber);
					currentPos = p.offset + p.length;
				});

				// Replace the document.
				editor.insertSnippet(snippet, new vs.Range(document.positionAt(startPos), document.positionAt(endPos)));
			});
		});
	}

	private snippetStringEscape(value: string): string {
		return value.replace(/\$|}|\\|,/g, "\\$&");
	}
}
