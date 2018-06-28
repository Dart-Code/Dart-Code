import * as vs from "vscode";
import { activate, currentDoc, ensureCompletion, getCompletionsAt, helloWorldCompletionFile, setTestContent } from "../../helpers";

describe("completion_item_provider", () => {

	beforeEach("activate helloWorldCompletionFile", () => activate(helloWorldCompletionFile));

	// This is not implemented. Turns out it's hard to detect this without having false positives
	// since we can't easily tell we're in a show/hide reliably.
	it.skip("does not add parens on functions in show/hide", async () => {
		const doc = currentDoc();
		await setTestContent(doc.getText().replace(/\/\/ IMPORTS HERE/mg, "import 'dart:io' show ;"));

		const completions = await getCompletionsAt("show ^;");

		ensureCompletion(completions, vs.CompletionItemKind.Function, "exit");
	});

	it("adds parens on functions in code", async () => {
		const doc = currentDoc();
		await setTestContent(doc.getText().replace(/\/\/ IMPORTS HERE/mg, "import 'dart:io' show exit;"));
		await setTestContent(doc.getText().replace(/\/\/ MAIN HERE/mg, "exi //"));

		const completions = await getCompletionsAt("exi^ //");

		ensureCompletion(completions, vs.CompletionItemKind.Function, "exit(…)");
	});
});
