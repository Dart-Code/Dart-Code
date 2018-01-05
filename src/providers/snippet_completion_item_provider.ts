"use strict";

import * as path from "path";
import {
	TextDocument, Position, CancellationToken, CompletionItemProvider, CompletionList,
	CompletionItem, CompletionItemKind, SnippetString, MarkdownString,
} from "vscode";
import { isArray } from "util";

export class SnippetCompletionItemProvider implements CompletionItemProvider {
	private completions = new CompletionList();

	constructor(filename: string) {
		const snippets = require(path.join("../../..", filename));
		for (const snippetType of Object.keys(snippets)) {
			for (const snippetName of Object.keys(snippets[snippetType])) {
				const snippet = snippets[snippetType][snippetName];
				const completionItem = new CompletionItem(snippetName, CompletionItemKind.Snippet);
				completionItem.filterText = snippet.prefix;
				completionItem.insertText = new SnippetString(
					isArray(snippet.body)
						? snippet.body.join("\n")
						: snippet.body,
				);
				completionItem.detail = snippet.description;
				completionItem.documentation = new MarkdownString().appendCodeblock(completionItem.insertText.value);
				this.completions.items.push(completionItem);
			}
		}
	}

	public provideCompletionItems(
		document: TextDocument, position: Position, token: CancellationToken,
	): CompletionList {
		return this.completions;
	}
}
