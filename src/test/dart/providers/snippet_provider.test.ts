import { activate, ensureNoSnippet, ensureSnippet, getSnippetCompletionsAt, setTestContent } from "../../helpers";

describe("snippet_provider", () => {

	beforeEach("activate", () => activate());

	it("returns dart items", async () => {
		await setTestContent("for");
		const snippets = await getSnippetCompletionsAt("for^");
		ensureSnippet(snippets, "for", "for");
	});

	it("returns dart items before comment markers", async () => {
		await setTestContent("for // test");
		const snippets = await getSnippetCompletionsAt("for^");
		ensureSnippet(snippets, "for", "for");
	});

	it("does not return dart items after comment markers", async () => {
		await setTestContent("// for");
		const snippets = await getSnippetCompletionsAt("for^");
		ensureNoSnippet(snippets, "for");
	});

	it("does not returns dart items after comment markers that come after content", async () => {
		await setTestContent("some code // this will be a for loop");
		const snippets = await getSnippetCompletionsAt("for^");
		ensureNoSnippet(snippets, "for");
	});

	it("does not return flutter items", async () => {
		await setTestContent("stf");
		const snippets = await getSnippetCompletionsAt("stf^");
		ensureNoSnippet(snippets, "stful");
	});
});
