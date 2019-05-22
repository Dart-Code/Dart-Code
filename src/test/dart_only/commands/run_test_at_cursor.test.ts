import * as assert from "assert";
import * as vs from "vscode";
import { cursorIsInTest } from "../../../extension/commands/test";
import { activate, extApi, getPackages, helloWorldTestMainFile, openFile, positionOf, waitForResult } from "../../helpers";

describe("run test at cursor", () => {

	before("get packages", () => getPackages());
	beforeEach("activate and wait for outline", async () => {
		await activate(helloWorldTestMainFile);
		await waitForResult(() => !!extApi.fileTracker.getOutlineFor(helloWorldTestMainFile));
	});

	it("command is available when cursor is inside a test", async () => {
		const editor = await openFile(helloWorldTestMainFile);
		editor.selection = new vs.Selection(positionOf("expect^("), positionOf("^expect("));

		// Allow some time to check, because the flag is flipped in a selection change handler
		await waitForResult(() => cursorIsInTest);

		// Also ensure the command exists.
		const command = (await vs.commands.getCommands(true)).filter((id) => id === "dart.runTestAtCursor");
		assert.ok(command);
	});

	it("command is not available when cursor is not inside a test", async () => {
		const editor = await openFile(helloWorldTestMainFile);
		editor.selection = new vs.Selection(positionOf("main^("), positionOf("^main("));

		// Allow some time to check, because the flag is flipped in a selection change handler
		await waitForResult(() => !cursorIsInTest);
	});
});
