import * as assert from "assert";
import * as vs from "vscode";
import { activate, extApi, flutterTestOtherFile, getPackages, openFile, positionOf, waitForResult } from "../../helpers";

describe("run test at cursor", () => {

	before("get packages", () => getPackages());
	beforeEach("activate and wait for outline", async () => {
		await activate(flutterTestOtherFile);
		await waitForResult(() => !!extApi.fileTracker.getOutlineFor(flutterTestOtherFile));
	});

	it("command is available when cursor is inside a test", async () => {
		const editor = await openFile(flutterTestOtherFile);
		editor.selection = new vs.Selection(positionOf("expect^("), positionOf("^expect("));

		// Allow some time to check, because the flag is flipped in a selection change handler
		await waitForResult(() => extApi.cursorIsInTest);

		// Also ensure the command exists.
		const command = (await vs.commands.getCommands(true)).filter((id) => id === "dart.runTestAtCursor");
		assert.ok(command);
	});

	it("command is not available when cursor is not inside a test", async () => {
		const editor = await openFile(flutterTestOtherFile);
		editor.selection = new vs.Selection(positionOf("main^("), positionOf("^main("));

		// Allow some time to check, because the flag is flipped in a selection change handler
		await waitForResult(() => !extApi.cursorIsInTest);
	});
});
