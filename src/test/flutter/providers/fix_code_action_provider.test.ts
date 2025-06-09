import { strict as assert } from "assert";
import * as vs from "vscode";
import { activate, currentDoc, flutterEmptyFile, getPackages, rangeOf, setTestContent } from "../../helpers";

describe("fix_code_action_provider", () => {
	// We have tests that require external packages.
	before("get packages", () => getPackages());
	beforeEach("activate flutterEmptyFile and add test content", async () => {
		await activate(flutterEmptyFile);
		await setTestContent(`
			void f(Foo a, Foo b, Foo c) {}
		`);
	});

	it("returns expected items", async () => {
		const fixResults = await vs.commands.executeCommand<vs.CodeAction[]>("vscode.executeCodeActionProvider", currentDoc().uri, rangeOf("Fo||o"));
		assert.ok(fixResults);
		assert.ok(fixResults.length);
		assert.ok(fixResults.find((r) => r.title.includes("Create class 'Foo'")));
	});

	it("does not contain duplicates", async () => {
		const fixResults = await vs.commands.executeCommand<vs.CodeAction[]>("vscode.executeCodeActionProvider", currentDoc().uri, rangeOf("Fo||o"));
		assert.ok(fixResults);
		assert.ok(fixResults.length);
		// Ensure no edit is the same as one that came before it.
		fixResults.forEach((action1, index) => {
			fixResults.slice(index + 1).forEach((action2) => {
				assert.notDeepEqual(action1, action2);
			});
		});
	});
});
