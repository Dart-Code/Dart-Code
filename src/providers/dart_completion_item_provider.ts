"use strict";

import {
	TextDocument, Position, CancellationToken, CompletionItemProvider, CompletionList,
	CompletionItem, CompletionItemKind, TextEdit, Range, SnippetString, CompletionContext, CompletionTriggerKind,
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

	public provideCompletionItems(
		document: TextDocument, position: Position, token: CancellationToken, context: CompletionContext,
	): Thenable<CompletionList> {
		if (!this.shouldAllowCompletion(document, position, context))
			return;
		return new Promise<CompletionList>((resolve, reject) => {
			this.analyzer.completionGetSuggestionsResults({
				file: document.fileName,
				offset: document.offsetAt(position),
			}).then((resp) => {
				resolve(new CompletionList(resp.results.map((r) => this.convertResult(document, position, resp, r))));
			},
				() => reject(),
			);
		});
	}

	private shouldAllowCompletion(document: TextDocument, position: Position, context: CompletionContext): boolean {
		// Filter out auto triggered completions on certain characters based on the previous
		// characters (eg. to allow completion on " if it's part of an import).
		if (context.triggerKind === CompletionTriggerKind.TriggerCharacter) {
			const line = document.lineAt(position.line).text.slice(0, position.character);
			switch (context.triggerCharacter) {
				case "{":
					return line.endsWith("${");
				case "'":
					return line.endsWith("import '") || line.endsWith("export '");
				case "\"":
					return line.endsWith("import \"") || line.endsWith("export \"");
			}
		}

		// Otherwise, allow through.
		return true;
	}

	private convertResult(
		document: TextDocument, position: Position, notification: as.CompletionResultsNotification, suggestion: as.CompletionSuggestion,
	): CompletionItem {
		const element = suggestion.element;
		const elementKind = element ? this.getElementKind(element.kind) : null;

		let label = suggestion.displayText || suggestion.completion;
		let detail = "";
		const completionText = new SnippetString();

		// If element has parameters (METHOD/CONSTRUCTOR/FUNCTION), show its parameters.
		if (element && element.parameters && elementKind !== CompletionItemKind.Property && suggestion.kind !== "OVERRIDE") {
			label += element.parameters.length === 2 ? "()" : "(…)";
			detail = element.parameters;

			const hasParams = suggestion.parameterNames && suggestion.parameterNames.length > 0;
			// Use the replacement range to find out whether the character immediately following the completion would be a paren.
			const nextCharacterIsOpenParen = document.getText().substr(notification.replacementOffset + notification.replacementLength, 1) === "(";

			// Add placeholders for params to the completion.
			if (config.for(document.uri).insertArgumentPlaceholders && hasParams && !nextCharacterIsOpenParen) {
				completionText.appendText(suggestion.completion);
				const args = suggestion.parameterNames.slice(0, suggestion.requiredParameterCount);
				if (args.length) {
					completionText.appendText("(");
					completionText.appendPlaceholder(args[0]);
					for (const arg of args.slice(1)) {
						completionText.appendText(", ");
						completionText.appendPlaceholder(arg);
					}
					completionText.appendText(")");
					completionText.appendPlaceholder("", 0); // TODO: Always do this??
				} else
					completionText.appendPlaceholder("");
			} else if (!nextCharacterIsOpenParen) {
				completionText.appendText(suggestion.completion);
				completionText.appendText("(");
				if (hasParams)
					completionText.appendPlaceholder("");
				completionText.appendText(")");
			} else {
				completionText.appendText(suggestion.completion);
			}
		} else if (suggestion.selectionOffset > 0) {
			const before = suggestion.completion.slice(0, suggestion.selectionOffset);
			const selection = suggestion.completion.slice(suggestion.selectionOffset, suggestion.selectionLength) || suggestion.parameterName;
			const after = suggestion.completion.slice(suggestion.selectionOffset + suggestion.selectionLength);

			completionText.appendText(before);
			completionText.appendPlaceholder(selection || "");
			completionText.appendText(after);
		} else {
			completionText.appendText(suggestion.completion);
		}

		// If we're a property, work out the type.
		if (elementKind === CompletionItemKind.Property) {
			// Setters appear as methods with one arg (and cause getters to not appear),
			// so treat them both the same and just display with the properties type.
			detail = element.kind === "GETTER"
				? element.returnType
				// See https://github.com/dart-lang/sdk/issues/27747
				: element.parameters ? element.parameters.substring(1, element.parameters.lastIndexOf(" ")) : "";
			// Otherwise, get return type from method.
		} else if (element && element.returnType) {
			detail =
				detail === ""
					? element.returnType
					: detail + " → " + element.returnType;
		} else if (suggestion.parameterType) {
			detail = suggestion.parameterType;
		}

		// If we have trailing commas (flutter) they look weird in the list, so trim the off (for display label only).
		if (label.endsWith(","))
			label = label.substr(0, label.length - 1).trim();

		const kind = suggestion.element
			? this.getElementKind(suggestion.element.kind)
			: this.getSuggestionKind(suggestion.kind);

		const completion = new CompletionItem(label, kind);
		completion.label = label;
		completion.kind = kind;
		completion.detail = (suggestion.isDeprecated ? "(deprecated) " : "") + detail;
		completion.documentation = suggestion.docSummary;
		completion.insertText = completionText;
		completion.range = new Range(
			document.positionAt(notification.replacementOffset),
			document.positionAt(notification.replacementOffset + notification.replacementLength),
		);

		switch (label) {
			case "import '';":
				completion.command = {
					command: "editor.action.triggerSuggest",
					title: "Suggest",
				};
				break;
		}

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
			case "CLASS_TYPE_ALIAS":
				return CompletionItemKind.Class;
			case "COMPILATION_UNIT":
				return CompletionItemKind.Module;
			case "CONSTRUCTOR":
			case "CONSTRUCTOR_INVOCATION":
				return CompletionItemKind.Constructor;
			case "ENUM":
			case "ENUM_CONSTANT":
				return CompletionItemKind.Enum;
			case "FIELD":
				return CompletionItemKind.Field;
			case "FILE":
				return CompletionItemKind.File;
			case "FUNCTION":
			case "FUNCTION_TYPE_ALIAS":
				return CompletionItemKind.Function;
			case "GETTER":
				return CompletionItemKind.Property;
			case "LABEL":
			case "LIBRARY":
				return CompletionItemKind.Module;
			case "LOCAL_VARIABLE":
				return CompletionItemKind.Variable;
			case "METHOD":
				return CompletionItemKind.Method;
			case "PARAMETER":
			case "PREFIX":
				return CompletionItemKind.Variable;
			case "SETTER":
				return CompletionItemKind.Property;
			case "TOP_LEVEL_VARIABLE":
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
