import * as assert from "assert";
import * as vs from "vscode";
import { activate, doc, helloWorldCreateMethodClassAFile, helloWorldCreateMethodClassBFile, openFile, rangeOf } from "../../helpers";

describe.only("fix_code_action_provider", () => {

	before("activate helloWorldCreateMethodClassBFile and add test content", async () => {
		await activate(helloWorldCreateMethodClassBFile);
	});

	it("modifies correct file when main edit is not in the original file", async () => {
		openFile(helloWorldCreateMethodClassBFile);
		const fixResults = await (vs.commands.executeCommand("vscode.executeCodeActionProvider", doc.uri, rangeOf("createNon||ExistentMethod")) as Thenable<vs.CodeAction[]>);
		assert.ok(fixResults);
		assert.ok(fixResults.length);

		const createMethodFix = fixResults.find((r) => r.title.indexOf("Create method 'createNonExistentMethod'") !== -1);
		assert.ok(createMethodFix);

		await (vs.commands.executeCommand(createMethodFix.command.command, ...createMethodFix.command.arguments));

		const fileA = await openFile(helloWorldCreateMethodClassAFile);
		const fileB = await openFile(helloWorldCreateMethodClassBFile);

		assert.notEqual(fileA.document.getText().indexOf("void createNonExistentMethod()"), -1, "Edit did not appear in file A");
		assert.equal(fileB.document.getText().indexOf("void createNonExistentMethod()"), -1, "Edit unexpectedly appeared in file B");
	});
});
