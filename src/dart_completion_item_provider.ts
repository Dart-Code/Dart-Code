"use strict";

import { TextDocument, Position, CancellationToken, CompletionItemProvider, CompletionList, CompletionItem, CompletionItemKind, TextEdit, Range } from "vscode";
import { Analyzer } from "./analyzer";
import * as as from "./analysis_server_types";

export class DartCompletionItemProvider implements CompletionItemProvider {
	private analyzer: Analyzer;
	constructor(analyzer: Analyzer) {
		this.analyzer = analyzer;
	}

	provideCompletionItems(document: TextDocument, position: Position, token: CancellationToken): Thenable<CompletionList> {
		return new Promise<CompletionList>((resolve, reject) => {
			this.analyzer.completionGetSuggestions({
				file: document.fileName,
				offset: document.offsetAt(position)
			}).then(resp => {
				var disposable = this.analyzer.registerForCompletionResults(notification => {
					// Skip any results that are not ours (or are not the final results).
					if (notification.id != resp.id || !notification.isLast)
						return;

					disposable.dispose();
					resolve(new CompletionList(notification.results.map(r => this.convertResult(document, notification, r))));
				})
			});
		});
	}

	private convertResult(document: TextDocument, notification: as.CompletionResultsNotification, suggestion: as.CompletionSuggestion): CompletionItem {
		let start = document.positionAt(suggestion.selectionOffset);
		return {
			label: suggestion.completion,
			kind: this.getKind(suggestion.kind),
			detail: suggestion.element != null ? suggestion.element.kind : null,
			documentation: suggestion.docSummary,
			sortText: null, // TODO: Make it so we don't need to provide all this stuff
			filterText: null,
			insertText: null,
			textEdit: new TextEdit(
				new Range(
					document.positionAt(notification.replacementOffset),
					document.positionAt(notification.replacementOffset + notification.replacementLength)
				),
				suggestion.completion
			)
		};
	}

	private getKind(kind: as.CompletionSuggestionKind): CompletionItemKind {
		// TODO: Review these...
		switch (kind) {
			case "ARGUMENT_LIST":
				return CompletionItemKind.Variable;
			case "IMPORT":
				return CompletionItemKind.Module;
			case "IDENTIFIER":
				return CompletionItemKind.Variable;
			case "INVOCATION":
				return CompletionItemKind.Method;
			case "KEYWORD":
				return CompletionItemKind.Keyword;
			case "NAMED_ARGUMENT":
				return CompletionItemKind.Variable;
			case "OPTIONAL_ARGUMENT":
				return CompletionItemKind.Variable;
			case "PARAMETER":
				return CompletionItemKind.Value;
		}
	}
}