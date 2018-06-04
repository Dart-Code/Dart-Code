import * as vs from "vscode";
import { activate, ensureCompletion, flutterHelloWorldMainFile, getCompletionsAt } from "../../helpers";

describe("completion_item_provider", () => {

	before("activate flutterHelloWorldMainFile", () => activate(flutterHelloWorldMainFile));

	it("returns expected items", async () => {
		const completions = await getCompletionsAt("new ^Text");

		ensureCompletion(completions, vs.CompletionItemKind.Constructor, "Text(…)");
		ensureCompletion(completions, vs.CompletionItemKind.Constructor, "Text.rich(…)");
		ensureCompletion(completions, vs.CompletionItemKind.Constructor, "Padding(…)");
	});
});
