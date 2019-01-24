import * as vs from "vscode";
import { activate, ensureCompletion, flutterHelloWorldMainFile, getCompletionsAt, getPackages } from "../../helpers";

describe("completion_item_provider", () => {

	// We have tests that require external packages.
	before("get packages", () => getPackages());
	beforeEach("activate flutterHelloWorldMainFile", () => activate(flutterHelloWorldMainFile));

	it("returns expected items", async () => {
		const completions = await getCompletionsAt("new ^Text");

		ensureCompletion(completions, vs.CompletionItemKind.Constructor, "Text(…)", "Text");
		ensureCompletion(completions, vs.CompletionItemKind.Constructor, "Text.rich(…)", "Text.rich");
		ensureCompletion(completions, vs.CompletionItemKind.Constructor, "Padding(…)", "Padding");
	});
});
