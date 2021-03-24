import * as vs from "vscode";
import { ClientCapabilities, StaticFeature } from "vscode-languageclient";
import { DartCapabilities } from "../../shared/capabilities/dart";
import { IAmDisposable } from "../../shared/interfaces";
import { disposeAll } from "../../shared/utils";
import { config } from "../config";

export class SnippetTextEditFeature implements IAmDisposable {
	private disposables: IAmDisposable[] = [];

	constructor(private readonly dartCapabilities: DartCapabilities) {
		this.disposables.push(vs.commands.registerCommand("_dart.applySnippetTextEdit", this.applySnippetTextEdit, this));
	}

	public get feature(): StaticFeature {
		const supportsSnippetTextEdits = this.dartCapabilities.supportsSnippetTextEdits;
		const snippetTextEditsEnabled = config.lspSnippetTextEdits;

		return {
			dispose() { },
			fillClientCapabilities(capabilities: ClientCapabilities) {
				capabilities.experimental = capabilities.experimental ?? {};
				if (supportsSnippetTextEdits && snippetTextEditsEnabled) {
					(capabilities.experimental as any).snippetTextEdit = true;
				}
			},
			initialize() { },
		};
	}

	public rewriteSnippetTextEditsToCommands(documentVersion: number, res: Array<vs.Command | vs.CodeAction> | null | undefined) {
		if (!res)
			return;

		for (const action of res) {
			if ("edit" in action) {
				const edit = action.edit;
				if (edit) {
					const entries = edit.entries();
					if (entries.length === 1 && entries[0][1].length === 1) {
						const uri = entries[0][0];
						const textEdit = entries[0][1][0];
						// HACK: This should be checking InsertTextFormat:
						// https://github.com/microsoft/language-server-protocol/issues/724#issuecomment-800334721
						const hasSnippet = /\$(0|\{0:([^}]*)\})/.test(textEdit.newText);
						// if ((textEdit as any).insertTextFormat === InsertTextFormat.Snippet) {
						if (hasSnippet) {
							action.edit = undefined;
							action.command = {
								arguments: [documentVersion, uri, textEdit],
								command: "_dart.applySnippetTextEdit",
								title: "Apply edit",
							};
						}
					}
				}
			}
		}
	}

	private async applySnippetTextEdit(documentVersion: number, uri: vs.Uri, edit: vs.TextEdit) {
		const doc = await vs.workspace.openTextDocument(uri);
		const editor = await vs.window.showTextDocument(doc);

		if (doc.version !== documentVersion)
			vs.window.showErrorMessage(`Unable to apply snippet, document was modified`);

		const leadingIndentCharacters = doc.lineAt(edit.range.start.line).firstNonWhitespaceCharacterIndex;
		const newText = this.compensateForVsCodeIndenting(edit.newText, leadingIndentCharacters);
		const snippet = new vs.SnippetString(newText);
		await editor.insertSnippet(snippet, edit.range);
	}

	private compensateForVsCodeIndenting(newText: string, leadingIndentCharacters: number) {
		const indent = " ".repeat(leadingIndentCharacters);
		const indentPattern = new RegExp(`\n${indent}`, "g");
		return newText.replace(indentPattern, "\n");
	}

	public dispose(): any {
		disposeAll(this.disposables);
	}
}
