import * as as from "../analysis/analysis_server_types";
import * as editors from "../editors";
import * as vs from "vscode";
import { Analyzer } from "../analysis/analyzer";
import { config } from "../config";

export class EditCommands implements vs.Disposable {
	private context: vs.ExtensionContext;
	private analyzer: Analyzer;
	private commands: vs.Disposable[] = [];

	constructor(context: vs.ExtensionContext, analyzer: Analyzer) {
		this.context = context;
		this.analyzer = analyzer;

		this.commands.push(
			vs.commands.registerCommand("dart.organizeDirectives", this.organizeDirectives, this),
			vs.commands.registerCommand("dart.sortMembers", this.sortMembers, this),
			vs.commands.registerCommand("_dart.applySourceChange", this.applyEdits, this),
			vs.workspace.onWillSaveTextDocument((e) => this.willSaveTextDocument(e), this),
		);
	}

	private organizeDirectives(): Thenable<void> {
		return this.sendEdit(this.analyzer.editOrganizeDirectives, "Organize Directives");
	}

	private sortMembers(): Thenable<void> {
		return this.sendEdit(this.analyzer.editSortMembers, "Sort Members");
	}

	private willSaveTextDocument(e: vs.TextDocumentWillSaveEvent) {
		// Don't do if setting is not enabled.
		if (!config.organizeDirectivesOnSave
			|| e.reason !== vs.TextDocumentSaveReason.Manual)
			return;

		const analyzer = this.analyzer;
		async function getEdits(): Promise<vs.TextEdit[]> {
			const response = await analyzer.editOrganizeDirectives({ file: e.document.fileName });
			const edit = response.edit;
			if (edit.edits.length === 0)
				return;

			return edit.edits.map((edit) => {
				const range = new vs.Range(
					e.document.positionAt(edit.offset),
					e.document.positionAt(edit.offset + edit.length),
				);
				return new vs.TextEdit(range, edit.replacement);
			});
		}

		e.waitUntil(getEdits());
	}

	private async sendEdit(f: (a: { file: string }) => Thenable<{ edit: as.SourceFileEdit }>, commandName: string): Promise<void> {
		if (!editors.hasActiveDartEditor()) {
			vs.window.showWarningMessage("No active Dart editor.");
			return;
		}

		const editor = vs.window.activeTextEditor;
		const document = editor.document;
		const documentVersion = document.version;

		f = f.bind(this.analyzer); // Yay JavaScript!

		try {
			const response = await f({ file: document.fileName });

			const edit = response.edit;
			if (edit.edits.length === 0)
				return;

			if (document.isClosed) {
				vs.window.showErrorMessage(`Error running ${commandName}: Document has been closed.`);
				return;
			}

			if (document.version !== document.version) {
				vs.window.showErrorMessage(`Error running ${commandName}: Document has been modified.`);
				return;
			}

			await editor.edit((editBuilder) => {
				edit.edits.forEach((edit) => {
					const range = new vs.Range(
						document.positionAt(edit.offset),
						document.positionAt(edit.offset + edit.length),
					);
					editBuilder.replace(range, edit.replacement);
				});
			});
		} catch (error) {
			vs.window.showErrorMessage(`Error running ${commandName}: ${error.message}.`);
		}
	}

	public dispose(): any {
		for (const command of this.commands)
			command.dispose();
	}

	private async applyEdits(document: vs.TextDocument, change: as.SourceChange): Promise<void> {
		// We can only apply with snippets if there's a single change.
		if (change.edits.length === 1 && change.linkedEditGroups != null && change.linkedEditGroups.length !== 0)
			return this.applyEditsWithSnippets(document, change);

		// Otherwise, just make all the edits without the snippets.
		const changes = new vs.WorkspaceEdit();

		for (const edit of change.edits) {
			for (const e of edit.edits) {
				const uri = vs.Uri.file(edit.file);
				const document = await vs.workspace.openTextDocument(uri);
				changes.replace(
					vs.Uri.file(edit.file),
					new vs.Range(
						document.positionAt(e.offset),
						document.positionAt(e.offset + e.length),
					),
					e.replacement,
				);
			}
		}

		// Apply the edits.
		await vs.workspace.applyEdit(changes);

		// Set the cursor position.
		if (change.selection) {
			const pos = document.positionAt(change.selection.offset);
			const selection = new vs.Selection(pos, pos);
			const ed = await vs.window.showTextDocument(document);
			ed.selection = selection;
		}
	}

	private async applyEditsWithSnippets(document: vs.TextDocument, change: as.SourceChange): Promise<void> {
		const edit = change.edits[0];
		const editor = await vs.window.showTextDocument(document);
		// Apply of all of the edits.
		await editor.edit((eb) => {
			edit.edits.forEach((e) => {
				eb.replace(
					new vs.Range(document.positionAt(e.offset), document.positionAt(e.offset + e.length)),
					e.replacement,
				);
			});
		});
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
		await editor.insertSnippet(snippet, new vs.Range(document.positionAt(startPos), document.positionAt(endPos)));
	}

	private snippetStringEscape(value: string): string {
		return value.replace(/\$|}|\\|,/g, "\\$&");
	}
}
