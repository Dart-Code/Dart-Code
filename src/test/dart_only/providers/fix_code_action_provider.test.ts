import * as assert from "assert";
import * as fs from "fs";
import * as vs from "vscode";
import { fsPath } from "../../../extension/utils";
import { activate, currentDoc, defer, emptyFile, helloWorldCreateMethodClassAFile, helloWorldCreateMethodClassBFile, missingFile, openFile, rangeOf, setTestContent, tryDelete, uncommentTestFile, waitForNextAnalysis } from "../../helpers";

describe("fix_code_action_provider", () => {
	beforeEach("activate", () => activate());

	it("modifies correct file when single edit is not in the original file", async () => {
		await openFile(helloWorldCreateMethodClassBFile);
		await waitForNextAnalysis(() => uncommentTestFile());
		const fixResults = await (vs.commands.executeCommand("vscode.executeCodeActionProvider", currentDoc().uri, rangeOf("createNon||ExistentMethod")) as Thenable<vs.CodeAction[]>);
		assert.ok(fixResults);
		assert.ok(fixResults.length);

		const createMethodFix = fixResults.find((r) => r.title.indexOf("Create method 'createNonExistentMethod'") !== -1);
		assert.ok(createMethodFix);

		await (vs.commands.executeCommand(createMethodFix!.command!.command, ...createMethodFix!.command!.arguments || []));

		const fileA = await openFile(helloWorldCreateMethodClassAFile);
		const fileB = await openFile(helloWorldCreateMethodClassBFile);

		assert.notEqual(fileA.document.getText().indexOf("void createNonExistentMethod()"), -1, "Edit did not appear in file A");
		assert.equal(fileB.document.getText().indexOf("void createNonExistentMethod()"), -1, "Edit unexpectedly appeared in file B");
	});

	it("can create", async () => {
		defer(() => tryDelete(missingFile));
		await openFile(emptyFile);
		await setTestContent("import 'missing.dart'");
		const fixResults = await (vs.commands.executeCommand("vscode.executeCodeActionProvider", currentDoc().uri, rangeOf("|missing.dart|")) as Thenable<vs.CodeAction[]>);
		assert.ok(fixResults);
		assert.ok(fixResults.length);

		const createFileFix = fixResults.find((r) => r.title.indexOf("Create file 'missing.dart'") !== -1);
		assert.ok(createFileFix);

		await (vs.commands.executeCommand(createFileFix!.command!.command, ...createFileFix!.command!.arguments || []));

		assert.ok(fs.existsSync(fsPath(missingFile)));
	});
});
