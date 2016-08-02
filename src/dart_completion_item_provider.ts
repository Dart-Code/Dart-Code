"use strict";

import * as vscode from "vscode";
import { Analyzer } from "./analyzer";
import * as as from "./analysis_server_types";

export class DartCompletionItemProvider implements vscode.CompletionItemProvider {
	private analyzer: Analyzer;
	constructor(analyzer: Analyzer) {
		this.analyzer = analyzer;
	}

	provideCompletionItems(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken): Thenable<vscode.CompletionList> {
		return new Promise<vscode.CompletionList>((resolve, reject) => {
			this.analyzer.completionGetSuggestions({
				file: document.fileName,
				offset: document.offsetAt(position)
			}).then(resp => {
				var disposable = this.analyzer.registerForCompletionResults(notification => {
					// Skip any results that are not ours (or are not the final results).
					if (notification.id != resp.id || !notification.isLast)
						return;

					disposable.dispose();
					resolve(new vscode.CompletionList(notification.results.map(r => this.convertResult(document, r))));
				})
			});
		});
	}

	private convertResult(document: vscode.TextDocument, suggestion: as.CompletionSuggestion): vscode.CompletionItem {
		let start = document.positionAt(suggestion.selectionOffset);
		return {
			label: suggestion.completion,
			kind: this.getKind(suggestion.kind),
			detail: suggestion.element != null ? suggestion.element.kind : null,
			documentation: suggestion.docSummary,
			sortText: null, // TODO: Make it so we don't need to provide all this stuff
			filterText: null,
			insertText: null,
			textEdit: null
		};
	}

	private getKind(kind: as.CompletionSuggestionKind): vscode.CompletionItemKind {
		// TODO: Review these...
		switch (kind) {
			case "ARGUMENT_LIST":
				return vscode.CompletionItemKind.Variable;
			case "IMPORT":
				return vscode.CompletionItemKind.Module;
			case "IDENTIFIER":
				return vscode.CompletionItemKind.Variable;
			case "INVOCATION":
				return vscode.CompletionItemKind.Method;
			case "KEYWORD":
				return vscode.CompletionItemKind.Keyword;
			case "NAMED_ARGUMENT":
				return vscode.CompletionItemKind.Variable;
			case "OPTIONAL_ARGUMENT":
				return vscode.CompletionItemKind.Variable;
			case "PARAMETER":
				return vscode.CompletionItemKind.Value;
		}
	}
}