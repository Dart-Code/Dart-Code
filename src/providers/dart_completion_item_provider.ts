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
		let element = suggestion.element;
		let elementKind = element ? this.getElementKind(element.kind) : null;

		let label = suggestion.completion;
		let detail: string = "";

		// If element has parameters (METHOD/CONSTRUCTOR/FUNCTION), show its
		// parameters.
		if (element && element.parameters && elementKind != CompletionItemKind.Property) {
			label += element.parameters.length == 2 ? "()" : "(…)";
			detail = element.parameters;
		}

		// If we're a property, work out the type. 
		if (elementKind == CompletionItemKind.Property) {
			// Setters appear as methods with one arg (and cause getters to not appear),
			// so treat them both the same and just display with the properties type.
			detail = element.kind == "GETTER"
				? element.returnType
				: element.parameters.substring(1, element.parameters.lastIndexOf(" "));
			// Otherwise, get return type from method.
		} else if (element && element.returnType)
			detail =
				detail == ""
					? element.returnType
					: detail + " → " + element.returnType;

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
			),
			additionalTextEdits: null,
			command: null
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
