import * as vs from "vscode";
import { dartRecommendedConfig, openSettingsAction } from "../../shared/constants";
import { IAmDisposable } from "../../shared/interfaces";
import { disposeAll } from "../../shared/utils";
import { getActiveRealFileEditor } from "../../shared/vscode/editors";
import { firstEditorColumn, showCode } from "../../shared/vscode/utils";
import { writeToPseudoTerminal } from "../utils/vscode/terminals";

export class EditCommands implements IAmDisposable {
	private disposables: IAmDisposable[] = [];

	constructor() {
		this.disposables.push(
			vs.commands.registerCommand("_dart.jumpToLineColInUri", this.jumpToLineColInUri.bind(this)),
			vs.commands.registerCommand("_dart.showCode", showCode),
			vs.commands.registerCommand("dart.writeRecommendedSettings", this.writeRecommendedSettings.bind(this)),
			vs.commands.registerCommand("dart.printSelectionToTerminal", this.printSelectionToTerminal.bind(this)),
			vs.commands.registerCommand("dart.toggleLineComment", this.toggleLineComment.bind(this)),
			vs.commands.registerCommand("dart.toggleDartdocComment", this.toggleDartdocComment.bind(this)),
			vs.commands.registerCommand("dart.sortMembers", () => this.runCodeAction("source.sortMembers")),
		);
	}

	private async runCodeAction(action: string) {
		return vs.commands.executeCommand("editor.action.codeAction", { kind: action, apply: "ifSingle" });
	}

	private async jumpToLineColInUri(uri: vs.Uri, lineNumber?: number, columnNumber?: number, inOtherEditorColumn?: boolean) {
		if (uri?.scheme !== "file")
			return;

		// When navigating while using the inspector, we don't expect this file to replace
		// the inspector tab, so we always target a column that's showing an editor.
		const column = inOtherEditorColumn
			? firstEditorColumn() ?? vs.ViewColumn.Beside
			: vs.ViewColumn.Active;

		const doc = await vs.workspace.openTextDocument(uri);
		const editor = await vs.window.showTextDocument(doc, column, inOtherEditorColumn);
		if (lineNumber) {
			const line = doc.lineAt(lineNumber > 0 ? lineNumber - 1 : 0);
			if (!columnNumber || columnNumber > line.range.end.character)
				columnNumber = line.firstNonWhitespaceCharacterIndex;
			else if (columnNumber > 0) {
				columnNumber--;
			}
			const char = line.range.start.translate({ characterDelta: columnNumber });
			showCode(editor, line.range, line.range, new vs.Range(char, char));
		}
	}

	private async writeRecommendedSettings(options?: { showNotification?: boolean }) {
		const topLevelConfig = vs.workspace.getConfiguration("", null);
		const dartLanguageConfig = topLevelConfig.inspect("[dart]");
		const existingConfig = dartLanguageConfig ? dartLanguageConfig.globalValue : undefined;
		const newValues = Object.assign({}, dartRecommendedConfig, existingConfig);
		await topLevelConfig.update("[dart]", newValues, vs.ConfigurationTarget.Global);

		if (options?.showNotification !== false) {
			const action = await vs.window.showInformationMessage(
				"Recommended settings were written to the [dart] section of your global settings file",
				openSettingsAction,
			);

			if (action === openSettingsAction)
				await vs.commands.executeCommand("workbench.action.openSettingsJson", { revealSetting: { key: "[dart]" } });
		}
	}

	private printSelectionToTerminal() {
		const editor = getActiveRealFileEditor();
		const selection = editor?.selection;
		const text = editor?.document?.getText(selection);

		if (text) {
			writeToPseudoTerminal([text]);
		}
	}

	private toggleDartdocComment() {
		return this.toggleLineComment(true);
	}

	private async toggleLineComment(onlyDartdoc = false) {
		const editor = getActiveRealFileEditor();
		if (!editor?.selections.length)
			return;
		const lines = this.getNonEmptySelectedLines(editor.document, editor.selections);
		if (!lines.length)
			return;

		// Track the prefix that matches all lines in all selections.
		// If any line does not start with `///` then it cannot be TRIPLE.
		// If any line does not start with '//' then it cannot be DOUBLE.
		// We start from the highest and work down as we find lines that don't match.
		let commonPrefix: "NONE" | "DOUBLE" | "TRIPLE" = "TRIPLE";
		for (const line of lines) {
			const text = line.text.trim();
			if (commonPrefix === "TRIPLE" && !text.startsWith("///"))
				commonPrefix = text.startsWith("//") ? "DOUBLE" : "NONE";
			else if (commonPrefix === "DOUBLE" && !text.startsWith("//"))
				commonPrefix = "NONE";

			// Any time we hit NONE, we can bail out.
			if (commonPrefix === "NONE")
				break;
		}

		switch (commonPrefix) {
			case "NONE":
				// If no prefix, insert doubles (or triples when onlyDartdoc).
				await this.prefixLines(editor, lines, onlyDartdoc ? "/// " : "// ");
				break;
			case "DOUBLE":
				// If already double, add an additional slash to make triple.
				await this.prefixLines(editor, lines, "/");
				break;
			case "TRIPLE":
				// If already triple, remove slashes.
				await this.removeLinePrefixes(editor, lines, ["/// ", "///"]);
				break;
		}
	}

	private getNonEmptySelectedLines(document: vs.TextDocument, selections: readonly vs.Selection[]): vs.TextLine[] {
		// In case we have overlapping selections, keep track of lines we've done.
		const doneLines = new Set<number>();
		const lines: vs.TextLine[] = [];
		for (const selection of selections) {
			for (let lineNumber = selection.start.line; lineNumber <= selection.end.line; lineNumber++) {
				if (doneLines.has(lineNumber))
					continue;
				doneLines.add(lineNumber);

				// Skip over blank lines, as they won't have comment markers and shouldn't
				// influence which common prefix we find.
				const line = document.lineAt(lineNumber);
				if (!line.isEmptyOrWhitespace)
					lines.push(line);
			}
		}
		return lines;
	}

	private async prefixLines(editor: vs.TextEditor, lines: vs.TextLine[], prefix: string) {
		// Find the minimum indent, so we can insert all slashes at the same level even if
		// there is indented code.
		const minIndent = Math.min(...lines.map((line) => line.firstNonWhitespaceCharacterIndex));

		await editor.edit((edit) => {
			for (const line of lines) {
				const insertionPoint = line.range.start.translate(0, minIndent);
				edit.insert(insertionPoint, prefix);
			}
		});
	}

	private async removeLinePrefixes(editor: vs.TextEditor, lines: vs.TextLine[], prefixes: string[]) {
		const document = editor.document;
		await editor.edit((edit) => {
			for (const line of lines) {
				const lineContentStart = line.range.start.translate(0, line.firstNonWhitespaceCharacterIndex);
				for (const prefix of prefixes) {
					const possiblePrefixRange = new vs.Range(lineContentStart, lineContentStart.translate(0, prefix.length));
					if (document.getText(possiblePrefixRange) === prefix) {
						edit.delete(possiblePrefixRange);
						break;
					}
				}
			}
		});
	}

	public dispose(): void {
		disposeAll(this.disposables);
	}
}
