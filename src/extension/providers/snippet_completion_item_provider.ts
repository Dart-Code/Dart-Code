import * as path from "path";
import { CancellationToken, CompletionContext, CompletionItem, CompletionItemKind, CompletionItemProvider, CompletionList, Position, SnippetString, TextDocument, Uri } from "vscode";
import { DartCapabilities } from "../../shared/capabilities/dart";
import { createMarkdownString, extensionPath, readJson } from "../../shared/vscode/extension_utils";
import { config } from "../config";

export class SnippetCompletionItemProvider implements CompletionItemProvider {
	private completions = new CompletionList();
	private shouldRender: (uri: Uri) => boolean;

	constructor(private readonly dartCapabilities: DartCapabilities, filename: string, shouldRender: (uri: Uri) => boolean) {
		this.shouldRender = shouldRender;
		const snippets = readJson(path.join(extensionPath, filename)) as Record<string, Record<string, { prefix: string, description: string | undefined, body: string | string[] }>>;
		for (const snippetType of Object.keys(snippets)) {
			for (const snippetName of Object.keys(snippets[snippetType])) {
				const snippet = snippets[snippetType][snippetName];
				const completionItem = new CompletionItem(snippetName, CompletionItemKind.Snippet);
				completionItem.filterText = snippet.prefix;
				completionItem.insertText = new SnippetString(
					Array.isArray(snippet.body)
						? snippet.body.join("\n")
						: snippet.body,
				);
				completionItem.detail = snippet.description;
				completionItem.documentation = createMarkdownString("").appendCodeblock(completionItem.insertText.value);
				completionItem.sortText = "zzzzzzzzzzzzzzzzzzzzzz";
				this.completions.items.push(completionItem);
			}
		}
	}

	public provideCompletionItems(
		document: TextDocument, position: Position, token: CancellationToken, context: CompletionContext,
	): CompletionList | undefined {
		if (!config.enableSnippets)
			return;

		if (config.enableServerSnippets)
			return;

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
		if (line.includes("//"))
			return false;

		// Otherwise, allow through.
		return true;
	}
}
