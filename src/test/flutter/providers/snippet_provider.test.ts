import { activate, ensureNoSnippet, ensureSnippet, flutterEmptyFile, getSnippetCompletionsAt, setTestContent } from "../../helpers";

describe("snippet_provider", () => {

	beforeEach("activate flutterEmptyFile", () => activate(flutterEmptyFile));

	it("returns dart items", async () => {
		await setTestContent("for");
		const snippets = await getSnippetCompletionsAt("for^");
		ensureSnippet(snippets, "for", "for");
	});

	it("returns flutter items", async () => {
		await setTestContent("stf");
		const snippets = await getSnippetCompletionsAt("stf^");
		ensureSnippet(snippets, "Flutter stateful widget", "stful");
	});

	it("does not return flutter items when typing on comment lines", async () => {
		await setTestContent("// stf");
		const snippets = await getSnippetCompletionsAt("stf^");
		ensureNoSnippet(snippets, "stful");
	});
});
