import * as vs from "vscode";
import { TextDocumentEdit, WorkspaceEdit } from "vscode-languageclient";
import { LspAnalyzer } from "../analysis/analyzer_lsp";
import * as editors from "../editors";

export class LspEditCommands implements vs.Disposable {
	private commands: vs.Disposable[] = [];

	constructor(private readonly analyzer: LspAnalyzer) {
		this.commands.push(
			vs.commands.registerCommand("dart.sortMembers", () => this.runCodeAction("source.sortMembers")),
		);
	}

	private getActiveEditor() {
		return editors.getActiveRealFileEditor();
	}

	private async runCodeAction(action: string) {
		return vs.commands.executeCommand("editor.action.codeAction", { kind: action, apply: "ifSingle" });
	}

	private async validDocumentVersionsStillMatch(edit: WorkspaceEdit): Promise<boolean> {
		// If the edit didn't have any documentChanges (it has changes) we have
		// to assume it's all up-to-date.
		if (!edit.documentChanges)
			return true;

		const openTextDocuments: Map<string, vs.TextDocument> = new Map<string, vs.TextDocument>();
		vs.workspace.textDocuments.forEach((document) => openTextDocuments.set(document.uri.toString(), document));

		for (const change of edit.documentChanges) {
			if (TextDocumentEdit.is(change) && change.textDocument.version && change.textDocument.version >= 0) {
				if (TextDocumentEdit.is(change) && change.textDocument.version && change.textDocument.version >= 0) {
					const textDocument = openTextDocuments.get(change.textDocument.uri);
					if (textDocument && textDocument.version !== change.textDocument.version) {
						return false;
					}
				}
			}
		}

		return true;
	}

	public dispose(): any {
		for (const command of this.commands)
			command.dispose();
	}
}
