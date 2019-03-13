import * as path from "path";
import * as vs from "vscode";
import { CancellationToken, CompletionContext, CompletionItem, CompletionItemKind, CompletionItemProvider, CompletionList, CompletionTriggerKind, Disposable, MarkdownString, Position, Range, SnippetString, TextDocument } from "vscode";
import * as as from "../analysis/analysis_server_types";
import { Analyzer } from "../analysis/analyzer";
import { hasOverlappingEdits } from "../commands/edit";
import { config } from "../config";
import { cleanDartdoc } from "../dartdocs";
import { flatMap, IAmDisposable } from "../debug/utils";
import { fsPath } from "../utils";
import { logError, logWarn } from "../utils/log";

export class DartCompletionItemProvider implements CompletionItemProvider, IAmDisposable {
	private disposables: Disposable[] = [];
	private cachedCompletions: { [key: number]: as.AvailableSuggestion[] } = {};

	constructor(private readonly analyzer: Analyzer) {
		this.disposables.push(analyzer.registerForCompletionAvailableSuggestions((n) => this.storeCompletionSuggestions(n)));
	}

	public async provideCompletionItems(
		document: TextDocument, position: Position, token: CancellationToken, context: CompletionContext,
	): Promise<CompletionList> {
		const line = document.lineAt(position.line).text.slice(0, position.character);
		const nextCharacter = document.getText(new Range(position, position.translate({ characterDelta: 200 }))).trim().substr(0, 1);
		const conf = config.for(document.uri);
		const enableCommitCharacters = conf.enableCompletionCommitCharacters;
		const insertArgumentPlaceholders = !enableCommitCharacters && conf.insertArgumentPlaceholders && this.shouldAllowArgPlaceholders(line);

		if (!this.shouldAllowCompletion(line, context))
			return;

		const resp = await this.analyzer.completionGetSuggestionsResults({
			file: fsPath(document.uri),
			offset: document.offsetAt(position),
		});

		const includedResults = resp.results.map((r) => this.convertResult(document, nextCharacter, enableCommitCharacters, insertArgumentPlaceholders, resp, r));
		const cachedResults = this.getCachedResults(document, nextCharacter, enableCommitCharacters, insertArgumentPlaceholders, document.offsetAt(position), resp);

		const allResults = [...includedResults, ...cachedResults];

		return new CompletionList(allResults);
	}

	private shouldAllowCompletion(line: string, context: CompletionContext): boolean {
		line = line.trim();
		// Filter out auto triggered completions on certain characters based on the previous
		// characters (eg. to allow completion on " if it's part of an import).
		if (context.triggerKind === CompletionTriggerKind.TriggerCharacter) {
			switch (context.triggerCharacter) {
				case "{":
					return line.endsWith("${");
				case "'":
					return line.endsWith("import '") || line.endsWith("export '");
				case "\"":
					return line.endsWith("import \"") || line.endsWith("export \"");
				case "/":
				case "\\":
					return line.startsWith("import \"") || line.startsWith("export \"")
						|| line.startsWith("import '") || line.startsWith("export '");
			}
		}

		// Otherwise, allow through.
		return true;
	}

	private shouldAllowArgPlaceholders(line: string): boolean {
		line = line.trim();

		// Disallow args on imports/exports since they're likely show/hide and
		// we only want the function name. This doesn't catch all cases (for ex.
		// where a show/hide is split across multiple lines) but it's better than
		// nothing. We'd need more semantic info to handle this better, and probably
		// this will go away if commit characters is fixed properly.
		if (line.startsWith("import \"") || line.startsWith("export \"")
			|| line.startsWith("import '") || line.startsWith("export '")) {
			return false;
		}

		return true;
	}

	private storeCompletionSuggestions(notification: as.CompletionAvailableSuggestionsNotification) {
		if (notification.changedLibraries) {
			for (const completionSet of notification.changedLibraries) {
				this.cachedCompletions[completionSet.id] = completionSet.items;
			}
		}
		if (notification.removedLibraries) {
			for (const completionSetID of notification.removedLibraries) {
				delete this.cachedCompletions[completionSetID];
			}
		}
	}

	public async resolveCompletionItem?(item: DelayedCompletionItem, token: CancellationToken): Promise<CompletionItem> {
		if (!item.suggestion)
			return;

		const suggestion: as.AvailableSuggestion = item.suggestion;

		const res = await this.analyzer.completionGetSuggestionDetails({
			file: item.filePath,
			id: item.suggestionSetID,
			label: item.suggestion.label,
			offset: item.offset,
		});

		const completionItem = this.makeCompletion(item.document, item.nextCharacter, item.enableCommitCharacters, item.insertArgumentPlaceholders, {
			completionText: res.completion,
			displayText: undefined,
			docSummary: suggestion.docSummary,
			elementKind: suggestion.element ? suggestion.element.kind : undefined,
			isDeprecated: false, // Not supported for unimported completions
			kind: "ARGUMENT_LIST", // TODO: NEED THIS???? NEED THIS???? NEED THIS???? NEED THIS???? NEED THIS???? NEED THIS???? NEED THIS????
			parameterNames: suggestion.parameterNames,
			parameterType: "TODO: PARAMETER TYPE??", // TODO
			parameters: suggestion.element ? suggestion.element.parameters : undefined,
			relevance: 0, // TODO: !!
			replacementLength: item.replacementLength,
			replacementOffset: item.replacementOffset,
			requiredParameterCount: suggestion.requiredParameterCount,
			returnType: suggestion.element ? suggestion.element.returnType : undefined,
			selectionLength: res.change && res.change.selection ? 0 : undefined,
			selectionOffset: res.change && res.change.selection ? res.change.selection.offset : undefined,
		});

		// Additional edits for the imports.
		completionItem.additionalTextEdits = convertSimpleEdits(item.document, res.change);

		return completionItem;
	}

	private getCachedResults(
		document: TextDocument,
		nextCharacter: string,
		enableCommitCharacters: boolean,
		insertArgumentPlaceholders: boolean,
		offset: number,
		resp: as.CompletionResultsNotification,
	): CompletionItem[] {
		if (!resp.includedSuggestionSets)
			return;

		const suggestionSetResults: CompletionItem[][] = [];
		for (let i = 0; i < resp.includedSuggestionSets.length; i++) {
			const suggestionSet = resp.includedSuggestionSets[i];
			const elementKinds = resp.includedElementKinds[i];
			// TODO: Use this somewhere?
			const relevanceTags = resp.includedSuggestionRelevanceTags[i];

			const results = this.cachedCompletions[suggestionSet.id];
			if (!results) {
				logWarn(`Suggestion set ${suggestionSet.id} was not available and therefore not included in the completion results`);
				return;
			}

			const unresolvedItems = results
				// TODO: How should we do this?
				.filter((r) => !elementKinds || elementKinds.indexOf(r.element.kind) !== -1)
				.map((r) => new DelayedCompletionItem(
					document,
					nextCharacter,
					enableCommitCharacters,
					insertArgumentPlaceholders,
					r,
					resp.replacementOffset,
					resp.replacementLength,
					offset,
					fsPath(document.uri),
					suggestionSet.id,
				));
			suggestionSetResults.push(unresolvedItems);
		}

		return [].concat(...suggestionSetResults);
	}

	private convertResult(
		document: TextDocument,
		nextCharacter: string,
		enableCommitCharacters: boolean,
		insertArgumentPlaceholders: boolean,
		notification: as.CompletionResultsNotification,
		suggestion: as.CompletionSuggestion,
	): CompletionItem {
		return this.makeCompletion(document, nextCharacter, enableCommitCharacters, insertArgumentPlaceholders, {
			completionText: suggestion.completion,
			displayText: suggestion.displayText,
			docSummary: suggestion.docSummary,
			elementKind: suggestion.element ? suggestion.element.kind : undefined,
			isDeprecated: suggestion.isDeprecated,
			kind: suggestion.kind,
			parameterNames: suggestion.parameterNames,
			parameterType: suggestion.parameterType,
			parameters: suggestion.element ? suggestion.element.parameters : undefined,
			relevance: suggestion.relevance,
			replacementLength: notification.replacementLength,
			replacementOffset: notification.replacementOffset,
			requiredParameterCount: suggestion.requiredParameterCount,
			returnType: suggestion.returnType,
			selectionLength: suggestion.selectionLength,
			selectionOffset: suggestion.selectionOffset,
		});
	}

	private makeCompletion(
		document: TextDocument, nextCharacter: string, enableCommitCharacters: boolean, insertArgumentPlaceholders: boolean, suggestion: {
			completionText: string,
			displayText: string | undefined,
			docSummary: string | undefined,
			elementKind: as.ElementKind | undefined,
			isDeprecated: boolean,
			kind: as.CompletionSuggestionKind,
			parameterNames: string[] | undefined,
			parameters: string | undefined,
			parameterType: string | undefined,
			relevance: number,
			replacementLength: number,
			replacementOffset: number,
			requiredParameterCount: number | undefined,
			returnType: string | undefined,
			selectionLength: number,
			selectionOffset: number,
		},
	): CompletionItem {
		const completionItemKind = suggestion.elementKind ? this.getElementKind(suggestion.elementKind) : undefined;
		let label = suggestion.displayText || suggestion.completionText;
		let detail = "";
		const completionText = new SnippetString();
		let triggerCompletion = false;

		const nextCharacterIsOpenParen = nextCharacter === "(";

		// If element has parameters (METHOD/CONSTRUCTOR/FUNCTION), show its parameters.
		if (suggestion.parameters && completionItemKind !== CompletionItemKind.Property && suggestion.kind !== "OVERRIDE"
			// Don't ever show if there is already a paren! (#969).
			&& label.indexOf("(") === -1
		) {
			label += suggestion.parameters.length === 2 ? "()" : "(…)";
			detail = suggestion.parameters;

			const hasParams = suggestion.parameterNames && suggestion.parameterNames.length > 0;

			// Add placeholders for params to the completion.
			if (insertArgumentPlaceholders && hasParams && !nextCharacterIsOpenParen) {
				completionText.appendText(suggestion.completionText);
				const args = suggestion.parameterNames.slice(0, suggestion.requiredParameterCount);
				completionText.appendText("(");
				if (args.length) {
					completionText.appendPlaceholder(args[0]);
					for (const arg of args.slice(1)) {
						completionText.appendText(", ");
						completionText.appendPlaceholder(arg);
					}
				} else
					completionText.appendTabstop(0); // Put a tap stop between parens since there are optional args.
				completionText.appendText(")");
			} else if (insertArgumentPlaceholders && !nextCharacterIsOpenParen) {
				completionText.appendText(suggestion.completionText);
				completionText.appendText("(");
				if (hasParams)
					completionText.appendTabstop(0);
				completionText.appendText(")");
			} else {
				completionText.appendText(suggestion.completionText);
			}
		} else if (suggestion.selectionOffset > 0) {
			const before = suggestion.completionText.slice(0, suggestion.selectionOffset);
			const selection = suggestion.completionText.slice(suggestion.selectionOffset, suggestion.selectionOffset + suggestion.selectionLength);
			// If we have a selection offset (eg. a place to put the cursor) but not any text to pre-select then
			// pop open the completion to help the user type the value.
			// Only do this if it ends with a space (argument completion), see #730.
			if (!selection && suggestion.completionText.slice(suggestion.selectionOffset - 1, suggestion.selectionOffset) === " ")
				triggerCompletion = true;
			const after = suggestion.completionText.slice(suggestion.selectionOffset + suggestion.selectionLength);

			completionText.appendText(before);
			if (selection)
				completionText.appendPlaceholder(selection);
			else
				completionText.appendTabstop(0);
			completionText.appendText(after);
		} else {
			completionText.appendText(suggestion.completionText);
		}

		// If we're a property, work out the type.
		if (completionItemKind === CompletionItemKind.Property) {
			// Setters appear as methods with one arg (and cause getters to not appear),
			// so treat them both the same and just display with the properties type.
			detail = suggestion.elementKind === "GETTER"
				? suggestion.returnType
				// See https://github.com/dart-lang/sdk/issues/27747
				: suggestion.parameters ? suggestion.parameters.substring(1, suggestion.parameters.lastIndexOf(" ")) : "";
			// Otherwise, get return type from method.
		} else if (suggestion.returnType) {
			detail =
				detail === ""
					? suggestion.returnType
					: detail + " → " + suggestion.returnType;
		} else if (suggestion.parameterType) {
			detail = suggestion.parameterType;
		}

		// If we have trailing commas (flutter) they look weird in the list, so trim the off (for display label only).
		if (label.endsWith(","))
			label = label.substr(0, label.length - 1).trim();

		const kind = completionItemKind || this.getSuggestionKind(suggestion.kind, label);

		const completion = new CompletionItem(label, kind);
		completion.label = label;
		completion.filterText = label.split("(")[0]; // Don't ever include anything after a ( in filtering.
		completion.kind = kind;
		completion.detail = (suggestion.isDeprecated ? "(deprecated) " : "") + detail;
		completion.documentation = new MarkdownString(cleanDartdoc(suggestion.docSummary));
		completion.insertText = completionText;
		completion.keepWhitespace = true;
		completion.range = new Range(
			document.positionAt(suggestion.replacementOffset),
			document.positionAt(suggestion.replacementOffset + suggestion.replacementLength),
		);
		if (enableCommitCharacters)
			completion.commitCharacters = this.getCommitCharacters(suggestion.kind);

		const triggerCompletionsFor = ["import '';"];
		if (triggerCompletionsFor.indexOf(label) !== -1)
			triggerCompletion = true;

		// Handle folders in imports better.
		if (suggestion.kind === "IMPORT" && label.endsWith("/"))
			triggerCompletion = true;

		if (triggerCompletion) {
			completion.command = {
				command: "editor.action.triggerSuggest",
				title: "Suggest",
			};
		}

		// Relevance is a number, highest being best. Code sorts by text, so subtract from a large number so that
		// a text sort will result in the correct order.
		// 555 -> 999455
		//  10 -> 999990
		//   1 -> 999999
		completion.sortText = (1000000 - suggestion.relevance).toString() + label.trim();
		return completion;
	}

	private getSuggestionKind(kind: as.CompletionSuggestionKind, label: string): CompletionItemKind {
		switch (kind) {
			case "ARGUMENT_LIST":
				return CompletionItemKind.Variable;
			case "IMPORT":
				return label.startsWith("dart:")
					? CompletionItemKind.Module
					: path.extname(label.toLowerCase()) === ".dart"
						? CompletionItemKind.File
						: CompletionItemKind.Folder;
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
				return CompletionItemKind.Enum;
			case "ENUM_CONSTANT":
				return CompletionItemKind.EnumMember;
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

	private getCommitCharacters(kind: as.CompletionSuggestionKind): string[] {
		switch (kind) {
			case "IDENTIFIER":
			case "INVOCATION":
				return [".", ",", "(", "["];
		}
	}

	public dispose(): any {
		this.disposables.forEach((d) => d.dispose());
	}
}

class DelayedCompletionItem extends CompletionItem {
	constructor(
		public readonly document: TextDocument,
		public readonly nextCharacter: string,
		public readonly enableCommitCharacters: boolean,
		public readonly insertArgumentPlaceholders: boolean,
		public readonly suggestion: as.AvailableSuggestion,
		public readonly replacementOffset: number,
		public readonly replacementLength: number,
		public readonly offset: number,
		public readonly filePath: string,
		public readonly suggestionSetID: number,
		kind?: CompletionItemKind) {
		super(suggestion.label, kind);
	}
}

function convertSimpleEdits(document: vs.TextDocument, change: as.SourceChange | undefined): vs.TextEdit[] | undefined {
	if (!change)
		return undefined;

	// VS Code expects offsets to be based on the original document, but the analysis server provides
	// them assuming all previous edits have already been made. This means if the server provides us a
	// set of edits where any edits offset is *equal to or greater than* a previous edit, it will do the wrong thing.
	// If this happens; we will fall back to sequential edits and write a warning.
	const hasProblematicEdits = hasOverlappingEdits(change);

	if (hasProblematicEdits) {
		logError("Unable to insert imports because of overlapping edits from the server.");
		vs.window.showErrorMessage(`Unable to insert imports because of overlapping edits from the server`);
		return undefined;
	}

	const filePath = fsPath(document.uri);

	if (change.edits.find((e) => e.file !== filePath)) {
		logError("Unable to insert imports because of edits included other files.");
		vs.window.showErrorMessage(`Unable to insert imports because of edits included other files`);
		return undefined;
	}

	return flatMap(change.edits, (edit) => {
		return edit.edits.map((edit) => {
			const range = new vs.Range(
				document.positionAt(edit.offset),
				document.positionAt(edit.offset + edit.length),
			);
			return new vs.TextEdit(range, edit.replacement);
		});
	});

}
