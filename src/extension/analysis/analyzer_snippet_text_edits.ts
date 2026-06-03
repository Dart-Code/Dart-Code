import * as vs from "vscode";
import { ClientCapabilities, FeatureState, StaticFeature } from "vscode-languageclient";
import { LanguageClient } from "vscode-languageclient/node";
import { IAmDisposable } from "../../shared/interfaces";
import { disposeAll } from "../../shared/utils";
import { config } from "../config";

export class SnippetTextEditFeature implements IAmDisposable {
	private disposables: IAmDisposable[] = [];

	constructor(client: LanguageClient) {
		this.disposables.push(vs.commands.registerCommand("_dart.applySnippetTextEdit", this.applySnippetTextEdit.bind(this)));
		this.addMiddleware(client);
	}

	public get feature(): StaticFeature {
		const snippetTextEditsEnabled = config.lspSnippetTextEdits;

		return {
			clear() { },
			fillClientCapabilities(capabilities: ClientCapabilities) {
				capabilities.experimental = capabilities.experimental ?? {};
				if (snippetTextEditsEnabled) {
					capabilities.experimental.snippetTextEdit = true;
				}
			},
			getState(): FeatureState {
				return { kind: "static" };
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
						// HACK: Check the injected "isCustomSnippet" field added in the asWorkspaceEdit overrides.
						const hasSnippet = !!(textEdit as any).isCustomSnippet;

						// HACK: Work around the server producing 0th choice tabstops that are not valid until a
						// server fix lands.
						// https://github.com/Dart-Code/Dart-Code/issues/3996
						if (hasSnippet
							// Has a 0th choice snippet.
							&& textEdit.newText.includes("${0|")
							&& textEdit.newText.includes("|}")
							// Does not have a 1st snippet.
							&& !textEdit.newText.includes("${1")
							&& !textEdit.newText.includes("$1")) {
							// "Upgrade" choice from tabstop 0 to tabstop 1.
							textEdit.newText = textEdit.newText.replace("${0|", "${1|");
						}

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

	private addMiddleware(client: LanguageClient) {
		const middleware = client.clientOptions.middleware ??= {};
		const previousProvideCodeActions = middleware.provideCodeActions;
		middleware.provideCodeActions = async (document, range, context, token, next) => {
			const documentVersion = document.version;
			const res = await (previousProvideCodeActions
				? previousProvideCodeActions(document, range, context, token, next)
				: next(document, range, context, token)) || [];

			this.rewriteSnippetTextEditsToCommands(documentVersion, res);
			return res;
		};
	}

	private async applySnippetTextEdit(documentVersion: number, uri: vs.Uri, edit: vs.TextEdit) {
		const doc = await vs.workspace.openTextDocument(uri);
		const editor = await vs.window.showTextDocument(doc);

		if (doc.version !== documentVersion)
			void vs.window.showErrorMessage(`Unable to apply snippet, document was modified`);

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
