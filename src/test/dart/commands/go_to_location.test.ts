import { strict as assert } from "assert";
import * as vs from "vscode";
import * as ls from "vscode-languageclient";
import { activate, closeAllOpenFiles, currentEditor, helloWorldMainFile } from "../../helpers";

describe("go_to_location", () => {
	beforeEach("activate", () => activate());

	async function testCommand(targetLocation: vs.Location | ls.Location) {
		await vs.commands.executeCommand("dart.goToLocation", targetLocation);
		const editor = currentEditor();
		assert.equal(editor.document.uri.toString(), helloWorldMainFile.toString());
		assert.equal(editor.selection.start.line, 0);
		assert.equal(editor.selection.start.character, 0);
		// Note: We only get a _position_ now, because we've moved to VS Code's goToLocation
		// command, which flashes the range, but leaves the selection at just the start.
		assert.equal(editor.selection.end.line, 0);
		assert.equal(editor.selection.end.character, 0);
	}

	it("navigates to expected location for a VS Code location", async () => {
		await closeAllOpenFiles();

		const targetRange = new vs.Range(new vs.Position(0, 0), new vs.Position(1, 1));
		const targetLocation = new vs.Location(helloWorldMainFile, targetRange);

		await testCommand(targetLocation);
	});

	it("navigates to expected location for an LSP location", async () => {
		await closeAllOpenFiles();

		const targetRange: ls.Range = { start: { line: 0, character: 0 }, end: { line: 1, character: 1 } };
		const targetLocation: ls.Location = { uri: helloWorldMainFile.toString(), range: targetRange };

		await testCommand(targetLocation);
	});
});
