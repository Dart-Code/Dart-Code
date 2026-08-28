import { strict as assert } from "assert";
import * as vs from "vscode";
import { activate, currentDoc, emptyFile, ensureTestContentWithSelection, openFile, privateApi, rangeOf, setTestContent } from "../../helpers";

describe("assist_code_action_provider", () => {
	beforeEach("activate", () => activate());

	it("handles Snippets in assists with choices", async function () {
		// In SDK versions that support interactive forms, the "Assign value to new local variable"
		// assist uses the interactive forms workflow rather than snippet text edits, so the
		// snippet-based path tested here is no longer exercised.
		if (privateApi.dartCapabilities.supportsInteractiveForms)
			this.skip();

		await openFile(emptyFile);
		await setTestContent(`
void f(String name) {
	name.length;
}`);
		const actionResults = await vs.commands.executeCommand<vs.CodeAction[]>("vscode.executeCodeActionProvider", currentDoc().uri, rangeOf("na||me.length"));
		assert.ok(actionResults);
		assert.ok(actionResults.length);

		const assignVarAction = actionResults.find((r) => r.title.includes("Assign value to new local variable"));
		assert.ok(assignVarAction, "Action was not found");

		// Older servers have simple edit, but newer has snippets.
		if (assignVarAction.edit) {
			await vs.workspace.applyEdit(assignVarAction.edit);
		} else if (assignVarAction.command) {
			await vs.commands.executeCommand(
				assignVarAction.command.command,
				...assignVarAction.command.arguments || [], // eslint-disable-line @typescript-eslint/no-unsafe-argument
			);
		} else {
			// If there's no edit or command, skip the test. This happens very infrequently and appears to be a VS Code
			// race condition. Rather than failing our test runs, skip.
			// TODO: Remove this when https://github.com/microsoft/vscode/issues/86403 is fixed/responded to.
			this.skip();
		}

		await ensureTestContentWithSelection(`
void f(String name) {
	var |length| = name.length;
}`);
	});
});
