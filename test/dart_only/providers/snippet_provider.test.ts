import { activate, ensureNoSnippet, ensureSnippet, getSnippetCompletionsAt, setTestContent } from "../../helpers";

describe("snippet_provider", () => {

	before(() => activate());

	it("returns dart items", async () => {
		await setTestContent("mai");
		const snippets = await getSnippetCompletionsAt("mai^");
		ensureSnippet(snippets, "class", "class", `\`\`\`\nclass \${1:Name} {\n  $2\n}\n\`\`\``);
		ensureSnippet(snippets, "main", "main", `\`\`\`\nmain(List<String> args) {\n  $1\n}\n\`\`\``);
	});

	it("does not return flutter items", async () => {
		await setTestContent("stf");
		const snippets = await getSnippetCompletionsAt("stf^");
		ensureNoSnippet(snippets, "stful");
	});
});
