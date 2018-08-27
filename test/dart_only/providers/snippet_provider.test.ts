import { activate, ensureNoSnippet, getSnippetCompletionsAt, setTestContent } from "../../helpers";

describe("snippet_provider", () => {

	beforeEach("activate", () => activate());

	it("does not return flutter items", async () => {
		await setTestContent("stf");
		const snippets = await getSnippetCompletionsAt("stf^");
		ensureNoSnippet(snippets, "stful");
	});
});
