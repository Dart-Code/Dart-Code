import * as assert from "assert";
import * as vs from "vscode";
import { activate, currentDoc, emptyFile, ensureTestContent, openFile, rangeOf, setTestContent } from "../../helpers";

describe("ignore_lint_code_action_provider", () => {
	beforeEach("activate", () => activate());

	it("provides action to edit a lint", async () => {
		await openFile(emptyFile);
		await setTestContent(`main() {
  var a = 1;
}`);
		const fixResults = await (vs.commands.executeCommand("vscode.executeCodeActionProvider", currentDoc().uri, rangeOf("|a| = 1")) as Thenable<vs.CodeAction[]>);
		assert.ok(fixResults);
		assert.ok(fixResults.length);

		const ignoreLintAction = fixResults.find((r) => r.title.indexOf("Ignore hint 'unused_local_variable' for this line") !== -1);
		assert.ok(ignoreLintAction);
	});

	it("puts ignore options at the end of the list", async () => {
		await openFile(emptyFile);
		await setTestContent(`main() {
  var a = 1;
}`);
		const fixResults = await (vs.commands.executeCommand("vscode.executeCodeActionProvider", currentDoc().uri, rangeOf("|a| = 1")) as Thenable<vs.CodeAction[]>);
		assert.ok(fixResults);
		assert.ok(fixResults.length);

		const filteredResults = fixResults.filter((f) => !vs.CodeActionKind.Source.contains(f.kind));

		const index = filteredResults.findIndex((r) => r.title.indexOf("Ignore hint 'unused_local_variable' for this line") !== -1);
		assert.equal(index, filteredResults.length - 1);
	});

	it("edits in '// ignore: ' comment", async () => {
		await openFile(emptyFile);
		await setTestContent(`main() {
  var a = 1;
}`);
		const fixResults = await (vs.commands.executeCommand("vscode.executeCodeActionProvider", currentDoc().uri, rangeOf("|a| = 1")) as Thenable<vs.CodeAction[]>);
		const ignoreLintAction = fixResults.find((r) => r.title.indexOf("Ignore hint 'unused_local_variable' for this line") !== -1);

		await vs.workspace.applyEdit(ignoreLintAction!.edit);

		await ensureTestContent(`main() {
  // ignore: unused_local_variable
  var a = 1;
}`);
	});
});
