import { activate, ensureSnippet, flutterEmptyFile, getSnippetCompletionsAt, setTestContent } from "../../helpers";

describe("snippet_provider", () => {

	beforeEach("activate flutterEmptyFile", () => activate(flutterEmptyFile));

	it("returns flutter items", async () => {
		await setTestContent("stf");
		const snippets = await getSnippetCompletionsAt("stf^");
		ensureSnippet(snippets, "Flutter stateful widget", "stful");
	});
});
