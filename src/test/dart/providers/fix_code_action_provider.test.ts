import { strict as assert } from "assert";
import * as fs from "fs";
import * as vs from "vscode";
import { fsPath } from "../../../shared/utils/fs";
import { activate, currentDoc, defer, emptyFile, ensureTestContent, helloWorldCreateMethodClassAFile, helloWorldCreateMethodClassBFile, missingFile, openFile, rangeOf, setTestContent, tryDelete, uncommentTestFile, waitForNextAnalysis } from "../../helpers";

describe("fix_code_action_provider", () => {
	beforeEach("activate", () => activate());

	it("modifies correct file when single edit is not in the original file", async () => {
		await openFile(helloWorldCreateMethodClassBFile);
		await waitForNextAnalysis(() => uncommentTestFile());
		const fixResults = await vs.commands.executeCommand<vs.CodeAction[]>("vscode.executeCodeActionProvider", currentDoc().uri, rangeOf("createNon||ExistentMethod"));
		assert.ok(fixResults);
		assert.ok(fixResults.length);

		const createMethodFix = fixResults.find((r) => r.title.includes("Create method 'createNonExistentMethod'"));
		assert.ok(createMethodFix);

		if (createMethodFix.edit)
			await vs.workspace.applyEdit(createMethodFix.edit);
		if (createMethodFix.command)
			await (vs.commands.executeCommand(createMethodFix.command.command, ...createMethodFix.command.arguments || [])); // eslint-disable-line @typescript-eslint/no-unsafe-argument

		const fileA = await openFile(helloWorldCreateMethodClassAFile);
		const fileB = await openFile(helloWorldCreateMethodClassBFile);

		assert.notEqual(fileA.document.getText().indexOf("void createNonExistentMethod()"), -1, "Edit did not appear in file A");
		assert.equal(fileB.document.getText().indexOf("void createNonExistentMethod()"), -1, "Edit unexpectedly appeared in file B");
	});

	it("can create", async () => {
		defer("Remove missing file", () => tryDelete(missingFile));
		await openFile(emptyFile);
		await setTestContent("import 'missing.dart'");
		const fixResults = await vs.commands.executeCommand<vs.CodeAction[]>("vscode.executeCodeActionProvider", currentDoc().uri, rangeOf("|missing.dart|"));
		assert.ok(fixResults);
		assert.ok(fixResults.length);

		const createFileFix = fixResults.find((r) => r.title.includes("Create file 'missing.dart'"));
		assert.ok(createFileFix, "Fix was not found");

		if (createFileFix.edit)
			await vs.workspace.applyEdit(createFileFix.edit);
		if (createFileFix.command)
			await (vs.commands.executeCommand(createFileFix.command.command, ...createFileFix.command.arguments || [])); // eslint-disable-line @typescript-eslint/no-unsafe-argument

		assert.ok(fs.existsSync(fsPath(missingFile)));
	});

	it("inserts correct indenting for create_method", async function () {
		await openFile(emptyFile);
		await setTestContent(`
main() {
	missing();
}
		`);
		const fixResults = await vs.commands.executeCommand<vs.CodeAction[]>("vscode.executeCodeActionProvider", currentDoc().uri, rangeOf("|missing()|"));
		assert.ok(fixResults);
		assert.ok(fixResults.length);

		const createFunctionFix = fixResults.find((r) => r.title.includes("Create function 'missing'"));
		assert.ok(createFunctionFix, "Fix was not found");

		// Older servers have simple edit, but newer has snippets.
		if (createFunctionFix.edit) {
			await vs.workspace.applyEdit(createFunctionFix.edit);
		} else if (createFunctionFix.command) {
			await vs.commands.executeCommand(
				createFunctionFix.command.command,
				...createFunctionFix.command.arguments || [], // eslint-disable-line @typescript-eslint/no-unsafe-argument
			);
		} else {
			// If there's no edit or command, skip the test. This happens very infrequently and appears to be a VS Code
			// race condition. Rather than failing our test runs, skip.
			// TODO: Remove this when https://github.com/microsoft/vscode/issues/86403 is fixed/responded to.
			this.skip();
			return;
		}

		await ensureTestContent(`
main() {
	missing();
}

void missing() {
}
		`);
	});

	it("supports adding missing dependencies (root)", async () => {
		await openFile(emptyFile);
		await setTestContent(`import 'package:abc/def.dart';`);

		const fixResults = await vs.commands.executeCommand<vs.CodeAction[]>("vscode.executeCodeActionProvider", currentDoc().uri, rangeOf("pack||age"));
		assert.ok(fixResults);
		assert.ok(fixResults.length);
		assert.ok(fixResults.find((r) => r.title.includes("Add 'abc' to dependencies")));
	});

	it("supports adding missing dependencies (nested)", async () => {
		await openFile(emptyFile);
		await setTestContent(`import 'package:abc/def/ghi.dart';`);

		const fixResults = await vs.commands.executeCommand<vs.CodeAction[]>("vscode.executeCodeActionProvider", currentDoc().uri, rangeOf("pack||age"));
		assert.ok(fixResults);
		assert.ok(fixResults.length);
		assert.ok(fixResults.find((r) => r.title.includes("Add 'abc' to dependencies")));
	});
});
