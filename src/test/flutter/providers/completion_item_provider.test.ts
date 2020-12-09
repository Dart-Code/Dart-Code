import * as assert from "assert";
import * as vs from "vscode";
import { activate, ensureCompletion, extApi, flutterHelloWorldMainFile, getCompletionsAt, getPackages, openFile, setTestContent } from "../../helpers";

describe("completion_item_provider", () => {

	// We have tests that require external packages.
	before("get packages", () => getPackages());
	beforeEach("activate flutterHelloWorldMainFile", () => activate(undefined));

	it("includes expected completions", async () => {
		await openFile(flutterHelloWorldMainFile);
		await extApi.currentAnalysis();
		const completions = await getCompletionsAt("return ^Text");

		ensureCompletion(completions, vs.CompletionItemKind.Constructor, "Text(…)", "Text");
		ensureCompletion(completions, vs.CompletionItemKind.Constructor, "Text.rich(…)", "Text.rich");
	});

	describe("with SuggestionSet support", () => {
		beforeEach("ensure SuggestionSets are supported", function () {
			if (extApi.analyzerCapabilities && !extApi.analyzerCapabilities.supportsAvailableSuggestions)
				this.skip();
		});

		it("includes overlapping unimported symbols from multiple files", async () => {
			await setTestContent(`
main() {
	EdgeInsetsDirecti
}
		`);
			const completions = await getCompletionsAt("EdgeInsetsDirecti^");
			const edgeInsetsCompletions = completions.filter((c) => c.label === "EdgeInsetsDirectional");
			// We should get at least 5 because it's in rendering, painting, widgets, material, cupertino.
			assert.equal(edgeInsetsCompletions.length >= 5, true);
		});

		it("does not include overlapping unimported symbols from multiple files if one is already imported", async () => {
			await setTestContent(`
import 'package:flutter/rendering.dart';

main() {
	EdgeInsetsDirecti
}
		`);
			const completions = await getCompletionsAt("EdgeInsetsDirecti^");
			const edgeInsetsCompletions = completions.filter((c) => c.label === "EdgeInsetsDirectional");
			// We should only get one from the already imported file.
			assert.equal(edgeInsetsCompletions.length, 1);
		});

		it("does not include duplicate enum values from multiple files if one is already imported", async () => {
			await setTestContent(`
import 'package:flutter/material.dart';

main() {
	var a = TextOverflo
}
		`);
			const completions = await getCompletionsAt("TextOverflo^");
			const clipCompletion = completions.filter((c) => c.label === "TextOverflow.clip");
			// We should only get one from the already imported file.
			assert.equal(clipCompletion.length, 1);
		});

		it.skip("log performance of completions", async () => {
			await setTestContent(`
import 'package:flutter/rendering.dart';

main() {
  ProcessInf
}
		`);
			const count = 50;
			const startMemory = process.memoryUsage();
			const startTime = Date.now();

			for (let i = 0; i < count; i++) {
				const startMemoryInner = process.memoryUsage();
				const startTimeInner = Date.now();

				const completions = await getCompletionsAt("ProcessInf^");
				ensureCompletion(completions, vs.CompletionItemKind.Class, "ProcessInfo", "ProcessInfo");

				const heapChangeMbs = (process.memoryUsage().heapUsed - startMemoryInner.heapUsed) / 1024 / 1024;
				console.log(`Iteration #${i < 10 ? " " : ""}${i} took ${Date.now() - startTimeInner} ms to return ${completions.length} results, heap change was ${Math.round(heapChangeMbs)} MB`);
			}

			const heapChangeMbs = (process.memoryUsage().heapUsed - startMemory.heapUsed) / 1024 / 1024;
			console.log(`Total run took ${Date.now() - startTime} ms heap change was ${Math.round(heapChangeMbs)} MB`);
		});
	});
});
