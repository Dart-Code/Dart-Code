"use strict";

import {
	TextDocument, Position, CancellationToken, CompletionItemProvider, CompletionList,
	CompletionItem, CompletionItemKind, TextEdit, Range
} from "vscode";
import { Analyzer } from "../analysis/analyzer";
import { logError } from "../utils";
import * as as from "../analysis/analysis_server_types";

export class DartCompletionItemProvider implements CompletionItemProvider {
	private analyzer: Analyzer;
	constructor(analyzer: Analyzer) {
		this.analyzer = analyzer;
	}

	provideCompletionItems(
		document: TextDocument, position: Position, token: CancellationToken
	): Thenable<CompletionList> {
		return new Promise<CompletionList>((resolve, reject) => {
			this.analyzer.completionGetSuggestions({
				file: document.fileName,
				offset: document.offsetAt(position)
			}).then(resp => {
				let disposable = this.analyzer.registerForCompletionResults(notification => {
					// Skip any results that are not ours (or are not the final results).
					if (notification.id != resp.id || !notification.isLast)
						return;

					disposable.dispose();
					resolve(new CompletionList(notification.results.map(r => {
						return this.convertResult(document, notification, r);
					})));
				})
			}, e => { logError(e); reject(); });
		});
	}

	private convertResult(
		document: TextDocument, notification: as.CompletionResultsNotification, suggestion: as.CompletionSuggestion
	): CompletionItem {
		let start = document.positionAt(suggestion.selectionOffset);
		let label = suggestion.completion;
		let detail: string = "";

		if (suggestion.element) {
			let element = suggestion.element;
			detail = element.kind.toLowerCase();

			// If element has parameters (METHOD/CONSTRUCTOR/FUNCTION), show its
			// parameters and return type.
			if (element.parameters) {
				label += element.parameters.length == 2 ? "()" : "(…)";

				let sig = `${element.name}${element.parameters}`;

				if (element.kind == "CONSTRUCTOR") {
					sig = (element.name)
						? `${suggestion.declaringType}.${sig}`
						: `${suggestion.declaringType}${sig}`;
				}

				detail += " " + sig;
			}

			if (element.returnType)
				detail += " → " + element.returnType
		}

		detail = detail.length == 0 ? detail = null : detail.trim();

		let kind = suggestion.element
			? this.getElementKind(suggestion.element.kind)
			: this.getSuggestionKind(suggestion.kind);

		return {
			label: label,
			kind: kind,
			detail: detail,
			documentation: suggestion.docSummary,
			sortText: null,
			filterText: null,
			insertText: suggestion.completion,
			textEdit: new TextEdit(
				new Range(
					document.positionAt(notification.replacementOffset),
					document.positionAt(notification.replacementOffset + notification.replacementLength)
				),
				suggestion.completion
			)
		};
	}

	private getSuggestionKind(kind: as.CompletionSuggestionKind): CompletionItemKind {
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

	private getElementKind(kind: as.ElementKind): CompletionItemKind {
		switch (kind) {
			case "CLASS":
				return CompletionItemKind.Class;
			case "CLASS_TYPE_ALIAS":
				return CompletionItemKind.Class;
			case "COMPILATION_UNIT":
				return CompletionItemKind.Module;
			case "CONSTRUCTOR":
				return CompletionItemKind.Constructor;
			case "ENUM":
				return CompletionItemKind.Enum;
			case "ENUM_CONSTANT":
				return CompletionItemKind.Enum;
			case "FIELD":
				return CompletionItemKind.Field;
			case "FILE":
				return CompletionItemKind.File;
			case "FUNCTION":
				return CompletionItemKind.Function;
			case "FUNCTION_TYPE_ALIAS":
				return CompletionItemKind.Function;
			case "GETTER":
				return CompletionItemKind.Property;
			case "LABEL":
				return CompletionItemKind.Module;
			case "LIBRARY":
				return CompletionItemKind.Module;
			case "LOCAL_VARIABLE":
				return CompletionItemKind.Variable;
			case "METHOD":
				return CompletionItemKind.Method;
			case "PARAMETER":
				return CompletionItemKind.Variable;
			case "PREFIX":
				return CompletionItemKind.Variable;
			case "SETTER":
				return CompletionItemKind.Property;
			case "TOP_LEVEL_VARIABLE":
				return CompletionItemKind.Variable;
			case "TYPE_PARAMETER":
				return CompletionItemKind.Variable;
			case "UNIT_TEST_GROUP":
				return CompletionItemKind.Module;
			case "UNIT_TEST_TEST":
				return CompletionItemKind.Method;
			case "UNKNOWN":
				return CompletionItemKind.Value;
		}
	}
}
