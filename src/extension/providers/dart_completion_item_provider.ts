import * as vs from "vscode";
import { CancellationToken, CompletionContext, CompletionItem, CompletionItemKind, CompletionItemProvider, CompletionList, CompletionTriggerKind, Disposable, MarkdownString, Position, Range, SnippetString, TextDocument } from "vscode";
import { flatMap } from "../../shared/utils";
import { DelayedCompletionItem } from "../../shared/vscode/interfaces";
import { fsPath } from "../../shared/vscode/utils";
import * as as from "../analysis/analysis_server_types";
import { Analyzer } from "../analysis/analyzer";
import { hasOverlappingEdits } from "../commands/edit";
import { config } from "../config";
import { cleanDartdoc } from "../dartdocs";
import { IAmDisposable } from "../debug/utils";
import { resolvedPromise } from "../utils";
import { logError, logWarn } from "../utils/log";
import { getElementKind, getSuggestionKind } from "../utils/vscode/mapping";

// TODO: This code has become messy with the SuggestionSet changes. It could do with some refactoring
// (such as creating a mapping from CompletionSuggestion -> x and SuggestionSet -> x, and then x -> CompletionItem).

export class DartCompletionItemProvider implements CompletionItemProvider, IAmDisposable {
	private disposables: Disposable[] = [];
	private cachedSuggestions: { [key: number]: CachedSuggestionSet } = {};

	constructor(private readonly analyzer: Analyzer) {
		this.disposables.push(analyzer.registerForCompletionAvailableSuggestions((n) => this.storeCompletionSuggestions(n)));
	}

	public async provideCompletionItems(
		document: TextDocument, position: Position, token: CancellationToken, context: CompletionContext,
	): Promise<CompletionList | undefined> {
		const line = document.lineAt(position.line).text.slice(0, position.character);
		const conf = config.for(document.uri);
		const enableCommitCharacters = conf.enableCompletionCommitCharacters;

		if (!this.shouldAllowCompletion(line, context))
			return;

		const resp = await this.analyzer.completionGetSuggestionsResults({
			file: fsPath(document.uri),
			offset: document.offsetAt(position),
		});

		if (token.isCancellationRequested)
			return undefined;

		const replacementRange = new vs.Range(
			document.positionAt(resp.replacementOffset),
			document.positionAt(resp.replacementOffset + resp.replacementLength),
		);

		const includedResults = resp.results.map((r) => this.convertResult(document, enableCommitCharacters, replacementRange, resp, r));
		const cachedResults = await this.getCachedResults(document, token, enableCommitCharacters, document.offsetAt(position), replacementRange, resp);

		await resolvedPromise;
		if (token.isCancellationRequested)
			return undefined;

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

	private storeCompletionSuggestions(notification: as.CompletionAvailableSuggestionsNotification) {
		if (notification.changedLibraries) {
			for (const completionSet of notification.changedLibraries) {
				const items: SuggestSetsByElementKind = {};
				completionSet.items.forEach((item) => {
					if (!items[item.element.kind])
						items[item.element.kind] = [];
					items[item.element.kind].push(item);
				});
				this.cachedSuggestions[completionSet.id] = new CachedSuggestionSet(completionSet.id, completionSet.uri, items);
			}
		}
		if (notification.removedLibraries) {
			for (const completionSetID of notification.removedLibraries) {
				delete this.cachedSuggestions[completionSetID];
			}
		}
	}

	public async resolveCompletionItem(item: DelayedCompletionItem, token: CancellationToken): Promise<CompletionItem | undefined> {
		if (!item.suggestion)
			return;

		const res = await this.analyzer.completionGetSuggestionDetails({
			file: item.filePath,
			id: item.suggestionSetID,
			label: item.suggestion.label,
			offset: item.offset,
		});

		if (token.isCancellationRequested) {
			return;
		}

		// Rebuild the completion using the additional resolved info.
		return this.createCompletionItemFromSuggestion(
			item.document,
			item.enableCommitCharacters,
			item.replacementRange,
			item.autoImportUri,
			item.relevance,
			item.suggestion,
			res,
		);
	}

	private createCompletionItemFromSuggestion(
		document: TextDocument,
		enableCommitCharacters: boolean,
		replacementRange: Range,
		displayUri: string | undefined,
		relevance: number,
		suggestion: as.AvailableSuggestion,
		resolvedResult: as.CompletionGetSuggestionDetailsResponse | undefined,
	) {
		const completionItem = this.makeCompletion(document, enableCommitCharacters, {
			autoImportUri: displayUri,
			completionText: (resolvedResult && resolvedResult.completion) || suggestion.label,
			displayText: undefined,
			docSummary: suggestion.docSummary,
			elementKind: suggestion.element ? suggestion.element.kind : undefined,
			isDeprecated: false,
			kind: undefined, // This is only used when there's no element (eg. keyword completions) that won't happen here.
			parameterNames: suggestion.parameterNames,
			parameterType: undefined, // Unimported completions can't be parameters.
			parameters: suggestion.element ? suggestion.element.parameters : undefined,
			relevance,
			replacementRange,
			requiredParameterCount: suggestion.requiredParameterCount,
			returnType: suggestion.element ? suggestion.element.returnType : undefined,
			selectionLength: resolvedResult && resolvedResult.change && resolvedResult.change.selection ? 0 : undefined,
			selectionOffset: resolvedResult && resolvedResult.change && resolvedResult.change.selection ? resolvedResult.change.selection.offset : undefined,
		});

		// Additional edits for the imports.
		if (resolvedResult && resolvedResult.change && resolvedResult.change.edits && resolvedResult.change.edits.length) {
			appendAdditionalEdits(completionItem, document, resolvedResult.change);
			if (displayUri)
				completionItem.detail = `Auto import from '${displayUri}'` + (completionItem.detail ? `\n\n${completionItem.detail}` : "");
		}

		return completionItem;
	}

	private async getCachedResults(
		document: TextDocument,
		token: CancellationToken,
		enableCommitCharacters: boolean,
		offset: number,
		replacementRange: Range,
		resp: as.CompletionResultsNotification,
	): Promise<CompletionItem[] | undefined> {
		if (!resp.includedSuggestionSets || !resp.includedElementKinds)
			return [];

		// Create a fast lookup for which kinds to include.
		const elementKinds: { [key: string]: boolean } = {};
		resp.includedElementKinds.forEach((k) => elementKinds[k] = true);

		// Create a fast lookup for relevance boosts based on tag string.
		const tagBoosts: { [key: string]: number } = {};
		resp.includedSuggestionRelevanceTags.forEach((r) => tagBoosts[r.tag] = r.relevanceBoost);

		const filePath = fsPath(document.uri);
		const results: CompletionItem[][] = [];
		for (const includedSuggestionSet of resp.includedSuggestionSets) {
			// Because this work is expensive, we periodically (per suggestion
			// set) yield and check whether cancellation is pending and if so
			// stop and bail out to avoid doing redundant work.
			await resolvedPromise;
			if (token.isCancellationRequested) {
				return undefined;
			}

			const suggestionSet = this.cachedSuggestions[includedSuggestionSet.id];
			if (!suggestionSet) {
				logWarn(`Suggestion set ${includedSuggestionSet.id} was not available and therefore not included in the completion results`);
				return [];
			}

			for (const kind of resp.includedElementKinds) {
				const suggestions = suggestionSet.itemsByKind[kind] || [];
				const setResults = suggestions.map((suggestion, i) => {

					// Calculate the relevance for this item.
					let relevanceBoost = 0;
					if (suggestion.relevanceTags)
						suggestion.relevanceTags.forEach((t) => relevanceBoost = Math.max(relevanceBoost, tagBoosts[t] || 0));

					const completionItem = this.createCompletionItemFromSuggestion(
						document,
						enableCommitCharacters,
						replacementRange,
						undefined,
						includedSuggestionSet.relevance + relevanceBoost,
						suggestion,
						undefined,
					);

					// Attach additional info that resolve will need.
					const delayedCompletionItem: DelayedCompletionItem = {
						autoImportUri: includedSuggestionSet.displayUri || suggestionSet.uri,
						document,
						enableCommitCharacters,
						filePath,
						offset,
						relevance: includedSuggestionSet.relevance + relevanceBoost,
						replacementRange,
						suggestion,
						suggestionSetID: includedSuggestionSet.id,
						...completionItem,
					};

					return delayedCompletionItem;
				});
				results.push(setResults);
			}
		}

		return [].concat(...results);
	}

	private convertResult(
		document: TextDocument,
		enableCommitCharacters: boolean,
		replacementRange: Range,
		notification: as.CompletionResultsNotification,
		suggestion: as.CompletionSuggestion,
	): CompletionItem {
		return this.makeCompletion(document, enableCommitCharacters, {
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
			replacementRange,
			requiredParameterCount: suggestion.requiredParameterCount,
			returnType: suggestion.returnType,
			selectionLength: suggestion.selectionLength,
			selectionOffset: suggestion.selectionOffset,
		});
	}

	private makeCompletion(
		document: TextDocument, enableCommitCharacters: boolean, suggestion: {
			autoImportUri?: string,
			completionText: string,
			displayText: string | undefined,
			docSummary: string | undefined,
			elementKind: as.ElementKind | undefined,
			isDeprecated: boolean,
			kind: as.CompletionSuggestionKind | undefined,
			parameterNames: string[] | undefined,
			parameters: string | undefined,
			parameterType: string | undefined,
			relevance: number,
			replacementRange: Range,
			requiredParameterCount: number | undefined,
			returnType: string | undefined,
			selectionLength: number,
			selectionOffset: number,
		},
	): CompletionItem {
		const completionItemKind = suggestion.elementKind ? getElementKind(suggestion.elementKind) : undefined;
		let label = suggestion.displayText || suggestion.completionText;
		let detail = "";
		const completionText = new SnippetString();
		let triggerCompletion = false;

		// If element has parameters (METHOD/CONSTRUCTOR/FUNCTION), show its parameters.
		if (suggestion.parameters && completionItemKind !== CompletionItemKind.Property && suggestion.kind !== "OVERRIDE"
			// Don't ever show if there is already a paren! (#969).
			&& label.indexOf("(") === -1
		) {
			label += suggestion.parameters.length === 2 ? "()" : "(…)";
			detail = suggestion.parameters;
			completionText.appendText(suggestion.completionText);
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

		// If we didnt have a CompletionItemKind from our element, base it on the CompletionSuggestionKind.
		// This covers things like Keywords that don't have elements.
		const kind = completionItemKind || (suggestion.kind ? getSuggestionKind(suggestion.kind, label) : undefined);

		const completion = new CompletionItem(label, kind);
		completion.label = label;
		completion.filterText = label.split("(")[0]; // Don't ever include anything after a ( in filtering.
		completion.kind = kind;
		completion.detail = (suggestion.isDeprecated ? "(deprecated) " : "") + detail;
		completion.documentation = new MarkdownString(cleanDartdoc(suggestion.docSummary));
		completion.insertText = completionText;
		completion.keepWhitespace = true;
		completion.range = suggestion.replacementRange;
		if (enableCommitCharacters)
			completion.commitCharacters = getCommitCharacters(suggestion.kind);

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

	public dispose(): any {
		this.disposables.forEach((d) => d.dispose());
	}
}

function getCommitCharacters(kind: as.CompletionSuggestionKind): string[] {
	switch (kind) {
		case "IDENTIFIER":
		case "INVOCATION":
			return [".", ",", "(", "["];
	}
}

function appendAdditionalEdits(completionItem: vs.CompletionItem, document: vs.TextDocument, change: as.SourceChange | undefined): void {
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
	const thisFilesEdits = change.edits.filter((e) => e.file === filePath);
	const otherFilesEdits = change.edits.filter((e) => e.file !== filePath);

	if (thisFilesEdits.length) {
		completionItem.additionalTextEdits = flatMap(thisFilesEdits, (edit) => {
			return edit.edits.map((edit) => {
				const range = new vs.Range(
					document.positionAt(edit.offset),
					document.positionAt(edit.offset + edit.length),
				);
				return new vs.TextEdit(range, edit.replacement);
			});
		});
	}
	if (otherFilesEdits.length) {
		const filteredSourceChange: as.SourceChange = {
			edits: otherFilesEdits,
			id: change.id,
			linkedEditGroups: undefined,
			message: change.message,
			selection: change.selection,
		};
		completionItem.command = {
			arguments: [document, filteredSourceChange],
			command: "_dart.applySourceChange",
			title: "Automatically add imports",
		};
	}
}

class CachedSuggestionSet {
	constructor(
		public readonly id: number,
		public readonly uri: string,
		public readonly itemsByKind: SuggestSetsByElementKind,
	) { }
}

type SuggestSetsByElementKind = { [key in as.ElementKind]?: as.AvailableSuggestion[] };
