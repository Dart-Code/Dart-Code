import * as vs from "vscode";
import * as as from "../analysis/analysis_server_types";
import { Analyzer } from "../analysis/analyzer";
import * as editors from "../editors";
import { fsPath } from "../utils";
import { logWarn } from "../utils/log";

export class EditCommands implements vs.Disposable {
	private context: vs.ExtensionContext;
	private analyzer: Analyzer;
	private commands: vs.Disposable[] = [];

	constructor(context: vs.ExtensionContext, analyzer: Analyzer) {
		this.context = context;
		this.analyzer = analyzer;

		this.commands.push(
			vs.commands.registerCommand("_dart.organizeImports", this.organizeImports, this),
			vs.commands.registerCommand("dart.sortMembers", this.sortMembers, this),
			vs.commands.registerCommand("_dart.applySourceChange", this.applyEdits, this),
			vs.commands.registerCommand("_dart.jumpToLineColInUri", this.jumpToLineColInUri, this),
			vs.commands.registerCommand("_dart.showCode", this.showCode, this),
			vs.commands.registerCommand("dart.completeStatement", this.completeStatement, this),
		);
	}

	private getActiveDoc() {
		return vs.window.activeTextEditor && vs.window.activeTextEditor.document;
	}

	private organizeImports(document: vs.TextDocument): Thenable<void> {
		document = document || this.getActiveDoc();
		return this.sendEdit(this.analyzer.editOrganizeDirectives, "Organize Imports", document || vs.window.activeTextEditor.document);
	}

	private async jumpToLineColInUri(uri: vs.Uri, lineNumber?: number, columnNumber?: number) {
		if (!uri || uri.scheme !== "file")
			return;

		const doc = await vs.workspace.openTextDocument(uri);
		const editor = await vs.window.showTextDocument(doc);
		if (lineNumber && columnNumber) {
			const line = doc.lineAt(lineNumber > 0 ? lineNumber - 1 : 0);
			const firstChar = line.range.start.translate({ characterDelta: line.firstNonWhitespaceCharacterIndex });
			this.showCode(editor, line.range, line.range, new vs.Range(firstChar, firstChar));
		}
	}

	private showCode(editor: vs.TextEditor, displayRange: vs.Range, highlightRange: vs.Range, selectionRange?: vs.Range): void {
		if (selectionRange)
			editor.selection = new vs.Selection(selectionRange.start, selectionRange.end);

		// Ensure the code is visible on screen.
		editor.revealRange(displayRange, vs.TextEditorRevealType.InCenterIfOutsideViewport);

		// Re-reveal the first line, to ensure it was always visible (eg. in case the main range was bigger than the screen).
		// Using .Default means it'll do as little scrolling as possible.
		editor.revealRange(new vs.Range(displayRange.start, displayRange.start), vs.TextEditorRevealType.Default);

		// TODO: Implement highlighting
		// See https://github.com/Microsoft/vscode/issues/45059
	}

	private sortMembers(document: vs.TextDocument): Thenable<void> {
		document = document || this.getActiveDoc();
		return this.sendEdit(this.analyzer.editSortMembers, "Sort Members", document);
	}

	private async completeStatement(): Promise<void> {
		const editor = vs.window.activeTextEditor;
		if (!editor || !editor.selection || !this.analyzer.capabilities.hasCompleteStatementFix)
			return;
		const document = editor.document;
		const file = fsPath(document.uri);
		const offset = document.offsetAt(editor.selection.end);

		const res = await this.analyzer.editGetStatementCompletion({ file, offset });

		if (res && res.change)
			await this.applyEdits(document, res.change);
	}

	private async sendEdit(f: (a: { file: string }) => Thenable<{ edit: as.SourceFileEdit }>, commandName: string, document: vs.TextDocument): Promise<void> {
		if (!editors.isDartDocument(document)) {
			vs.window.showWarningMessage("Not a Dart file.");
			return;
		}

		const originalDocumentVersion = document.version;
		const editor = await vs.window.showTextDocument(document);

		f = f.bind(this.analyzer); // Yay JavaScript!

		try {
			const response = await f({ file: fsPath(document.uri) });

			const edit = response.edit;
			if (edit.edits.length === 0)
				return;

			if (document.isClosed) {
				vs.window.showErrorMessage(`Error running ${commandName}: Document has been closed.`);
				return;
			}

			if (document.version !== originalDocumentVersion) {
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

	private async applyEdits(initiatingDocument: vs.TextDocument, change: as.SourceChange): Promise<void> {
		// We can only apply with snippets if there's a single change.
		if (change.edits.length === 1 && change.linkedEditGroups != null && change.linkedEditGroups.length !== 0)
			return this.applyEditsWithSnippets(initiatingDocument, change);

		// VS Code expects offsets to be based on the original document, but the analysis server provides
		// them assuming all previous edits have already been made. This means if the server provides us a
		// set of edits where any edits offset is *equal to or greater than* a previous edit, it will do the wrong thing.
		// If this happens; we will fall back to sequential edits and write a warning.
		const hasProblematicEdits = hasOverlappingEdits(change);

		if (hasProblematicEdits) {
			logWarn("Falling back to sequential edits due to overlapping edits in server.");
		}
		const applyEditsSequentially = hasProblematicEdits;

		// Otherwise, just make all the edits without the snippets.
		let changes = applyEditsSequentially ? undefined : new vs.WorkspaceEdit();

		for (const edit of change.edits) {
			for (const e of edit.edits) {
				const uri = vs.Uri.file(edit.file);
				const document = await vs.workspace.openTextDocument(uri);
				if (applyEditsSequentially)
					changes = new vs.WorkspaceEdit();
				changes.replace(
					vs.Uri.file(edit.file),
					new vs.Range(
						document.positionAt(e.offset),
						document.positionAt(e.offset + e.length),
					),
					e.replacement,
				);
				if (applyEditsSequentially) {
					await vs.workspace.applyEdit(changes);
					changes = undefined;
				}
			}
		}

		// If we weren't applying sequentially
		if (!applyEditsSequentially) {
			await vs.workspace.applyEdit(changes);
		}

		// Set the cursor position.
		if (change.selection) {
			const uri = vs.Uri.file(change.selection.file);
			const document = await vs.workspace.openTextDocument(uri);
			const editor = await vs.window.showTextDocument(document);
			const pos = document.positionAt(change.selection.offset);
			const selection = new vs.Selection(pos, pos);
			editor.selection = selection;
		} else {
			await vs.window.showTextDocument(initiatingDocument);
		}
	}

	private async applyEditsWithSnippets(initiatingDocument: vs.TextDocument, change: as.SourceChange): Promise<void> {
		const edit = change.edits[0];
		const document = await vs.workspace.openTextDocument(edit.file);
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

		// Ensure original document is the active one.
		await vs.window.showTextDocument(initiatingDocument);
	}

	private snippetStringEscape(value: string): string {
		return value.replace(/\$|}|\\|,/g, "\\$&");
	}
}

export function hasOverlappingEdits(change: as.SourceChange) {
	const priorEdits: { [file: string]: as.SourceEdit[] } = {};
	for (const edit of change.edits) {
		if (!priorEdits[edit.file])
			priorEdits[edit.file] = [];
		for (const e of edit.edits) {
			if (priorEdits[edit.file].find((pe) => pe.offset <= e.offset))
				return true;
			priorEdits[edit.file].push(e);
		}
	}
	return false;
}
