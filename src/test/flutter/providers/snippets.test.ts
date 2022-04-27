import { activate, ensureNoSnippet, ensureSnippet, flutterEmptyFile, getSnippetCompletionsAt, setTestContent } from "../../helpers";

describe("snippets", () => {

	beforeEach("activate flutterEmptyFile", () => activate(flutterEmptyFile));

	it("returns dart items", async () => {
		await setTestContent(`
		main() {
			for
		}
		`);
		const snippets = await getSnippetCompletionsAt("for^");
		ensureSnippet(snippets, "for", "for");
	});

	it("returns flutter items", async () => {
		await setTestContent("stf");
		const snippets = await getSnippetCompletionsAt("stf^");
		ensureSnippet(snippets, "Flutter Stateful Widget", "stful");
	});

	it("does not return flutter items when typing on comment lines", async () => {
		await setTestContent("// stf");
		const snippets = await getSnippetCompletionsAt("stf^");
		ensureNoSnippet(snippets, "stful");
	});
});
