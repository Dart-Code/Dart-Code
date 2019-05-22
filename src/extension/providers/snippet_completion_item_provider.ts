import * as path from "path";
import { isArray } from "util";
import { CancellationToken, CompletionContext, CompletionItem, CompletionItemKind, CompletionItemProvider, CompletionList, MarkdownString, Position, SnippetString, TextDocument, Uri } from "vscode";

export class SnippetCompletionItemProvider implements CompletionItemProvider {
	private completions = new CompletionList();
	private shouldRender: (uri: Uri) => boolean;

	constructor(filename: string, shouldRender: (uri: Uri) => boolean) {
		this.shouldRender = shouldRender;
		const snippets = require(path.join("../../../..", filename));
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
				completionItem.sortText = "zzzzzzzzzzzzzzzzzzzzzz";
				this.completions.items.push(completionItem);
			}
		}
	}

	public provideCompletionItems(
		document: TextDocument, position: Position, token: CancellationToken, context: CompletionContext,
	): CompletionList {
		const line = document.lineAt(position.line).text.slice(0, position.character);

		if (!this.shouldAllowCompletion(line, context))
			return;

		if (!this.shouldRender(document.uri))
			return;

		return this.completions;
	}

	private shouldAllowCompletion(line: string, context: CompletionContext): boolean {
		line = line.trim();

		// Don't provide completions after comment markers. This isn't perfect since it'll
		// suppress them for ex if // appears inside strings, but it's a reasonable
		// approximation given we don't have a reliable way to tell that.
		if (line.indexOf("//") !== -1)
			return false;

		// Otherwise, allow through.
		return true;
	}
}
