"use strict";

import {
	TextDocument, Position, CancellationToken, CompletionItemProvider, CompletionList,
	CompletionItem, CompletionItemKind, TextEdit, Range, SnippetString
} from "vscode";
import { Analyzer } from "../analysis/analyzer";
import { logError } from "../utils";
import { config } from "../config";
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
		// Since we're using SnippetString we need to escape some characters in the completion.
		const escapeSnippetString = (s: string) => (s || "").replace('$', '\\$').replace('{', '\\{').replace('}', '\\}');

		let element = suggestion.element;
		let elementKind = element ? this.getElementKind(element.kind) : null;

		let label = suggestion.completion;
		let completionText = "";
		let detail = "";

		// If element has parameters (METHOD/CONSTRUCTOR/FUNCTION), show its
		// parameters.
		if (element && element.parameters && elementKind != CompletionItemKind.Property) {
			label += element.parameters.length == 2 ? "()" : "(…)";
			detail = element.parameters;

			const hasParams = suggestion.parameterNames && suggestion.parameterNames.length > 0;

			// Add placeholders for params to the completion.
			if (config.for(document.uri).insertArgumentPlaceholders && hasParams) {
				let args = suggestion.parameterNames.slice(0, suggestion.requiredParameterCount);
				let argPlaceholders = args.map((n, i) => `\${${i + 1}:${n}}`).join(", ");

				// If blank, force in a dummy tabstop to go between the parens.
				if (argPlaceholders == "")
					argPlaceholders = "$1";

				completionText = escapeSnippetString(suggestion.completion) + `(${argPlaceholders})$0`;
			}
			else
				completionText = escapeSnippetString(suggestion.completion) + (hasParams ? `($0)` : `()`);
		}
		// Otherwise, if we have some selection, inject it.
		else if (suggestion.selectionOffset > 0) {
			const before = suggestion.completion.slice(0, suggestion.selectionOffset);
			const selection = suggestion.completion.slice(suggestion.selectionOffset, suggestion.selectionLength) || suggestion.parameterName;
			const after = suggestion.completion.slice(suggestion.selectionOffset + suggestion.selectionLength);

			completionText = escapeSnippetString(before) + `\${0:${escapeSnippetString(selection)}}` + escapeSnippetString(after);
		}
		// Otherwise, just use the raw text.	
		else {
			completionText = escapeSnippetString(suggestion.completion);
		}

		// If we're a property, work out the type. 
		if (elementKind == CompletionItemKind.Property) {
			// Setters appear as methods with one arg (and cause getters to not appear),
			// so treat them both the same and just display with the properties type.
			detail = element.kind == "GETTER"
				? element.returnType
				// See https://github.com/dart-lang/sdk/issues/27747
				: element.parameters ? element.parameters.substring(1, element.parameters.lastIndexOf(" ")) : "";
			// Otherwise, get return type from method.
		} else if (element && element.returnType) {
			detail =
				detail == ""
					? element.returnType
					: detail + " → " + element.returnType;
		} else if (suggestion.parameterType) {
			detail = suggestion.parameterType;
		}

		// If we have trailing commas (flutter) they look weird in the list, so trim the off (for display label only).
		if (label.endsWith(","))
			label = label.substr(0, label.length - 1).trim();

		let kind = suggestion.element
			? this.getElementKind(suggestion.element.kind)
			: this.getSuggestionKind(suggestion.kind);

		let completion = new CompletionItem(label, kind);
		completion.label = label;
		completion.kind = kind;
		completion.detail = (suggestion.isDeprecated ? "(deprecated) " : "") + detail;
		completion.documentation = suggestion.docSummary;
		completion.insertText = new SnippetString(completionText);
		completion.range = new Range(
			document.positionAt(notification.replacementOffset),
			document.positionAt(notification.replacementOffset + notification.replacementLength)
		);
		// Relevance is a number, highest being best. Code sorts by text, so subtract from a large number so that
		// a text sort will result in the correct order.
		// 555 -> 999455
		//  10 -> 999990
		//   1 -> 999999
		completion.sortText = (1000000 - suggestion.relevance).toString();
		return completion;
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
