import * as vs from "vscode";
import { activate, ensureCompletion, extApi, flutterHelloWorldMainFile, getCompletionsAt, getPackages, setTestContent } from "../../helpers";

describe("completion_item_provider", () => {

	// We have tests that require external packages.
	before("get packages", () => getPackages());
	beforeEach("activate flutterHelloWorldMainFile", () => activate(flutterHelloWorldMainFile));

	it("includes expected completions", async () => {
		const completions = await getCompletionsAt("new ^Text");

		ensureCompletion(completions, vs.CompletionItemKind.Constructor, "Text(…)", "Text");
		ensureCompletion(completions, vs.CompletionItemKind.Constructor, "Text.rich(…)", "Text.rich");
		ensureCompletion(completions, vs.CompletionItemKind.Constructor, "Padding(…)", "Padding");
	});

	describe("with SuggestionSet support", () => {
		beforeEach("ensure SuggestionSets are supported", function () {
			if (!extApi.analyzerCapabilities.supportsAvailableSuggestions)
				this.skip();
		});

		it.skip("log performance of completions", async () => {
			await setTestContent(`
main() {
  ProcessInf
}
		`);
			const count = 50;
			const start = Date.now();
			for (let i = 0; i < count; i++) {
				const startInner = Date.now();
				const completions = await getCompletionsAt("ProcessInf^");
				ensureCompletion(completions, vs.CompletionItemKind.Class, "ProcessInfo", "ProcessInfo");
				const endInner = Date.now();
				console.log(`Iteration #${i} took ${endInner - startInner}ms to return ${completions.length} results`);
			}
			const end = Date.now();
			console.log(`Took ${end - start}ms to do ${count} completion requests`);
		});
	});
});
