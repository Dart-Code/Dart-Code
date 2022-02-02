import { strict as assert } from "assert";
import * as fs from "fs";
import * as vs from "vscode";
import { fsPath } from "../../../shared/utils/fs";
import { activate, currentDoc, defer, emptyFile, ensureTestContent, extApi, helloWorldCreateMethodClassAFile, helloWorldCreateMethodClassBFile, missingFile, openFile, rangeOf, setTestContent, tryDelete, uncommentTestFile, waitForNextAnalysis } from "../../helpers";

describe("fix_code_action_provider", () => {
	beforeEach("activate", () => activate());

	it("modifies correct file when single edit is not in the original file", async function () {
		await openFile(helloWorldCreateMethodClassBFile);
		await waitForNextAnalysis(() => uncommentTestFile());
		const fixResults = await vs.commands.executeCommand<vs.CodeAction[]>("vscode.executeCodeActionProvider", currentDoc().uri, rangeOf("createNon||ExistentMethod"));
		assert.ok(fixResults);
		assert.ok(fixResults.length);

		const createMethodFix = fixResults.find((r) => r.title.indexOf("Create method 'createNonExistentMethod'") !== -1);
		assert.ok(createMethodFix);

		if (!createMethodFix.command) {
			// If there's no command, skip the test. This happens very infrequently and appears to be a VS Code
			// race condition. Rather than failing our test runs, skip.
			// TODO: Remove this when https://github.com/microsoft/vscode/issues/86403 is fixed/responded to.
			this.skip();
			return;
		}

		await (vs.commands.executeCommand(createMethodFix.command.command, ...createMethodFix.command.arguments || [])); // eslint-disable-line @typescript-eslint/no-unsafe-argument

		const fileA = await openFile(helloWorldCreateMethodClassAFile);
		const fileB = await openFile(helloWorldCreateMethodClassBFile);

		assert.notEqual(fileA.document.getText().indexOf("void createNonExistentMethod()"), -1, "Edit did not appear in file A");
		assert.equal(fileB.document.getText().indexOf("void createNonExistentMethod()"), -1, "Edit unexpectedly appeared in file B");
	});

	it("can create", async function () {
		defer("Remove missing file", () => tryDelete(missingFile));
		await openFile(emptyFile);
		await setTestContent("import 'missing.dart'");
		const fixResults = await vs.commands.executeCommand<vs.CodeAction[]>("vscode.executeCodeActionProvider", currentDoc().uri, rangeOf("|missing.dart|"));
		assert.ok(fixResults);
		assert.ok(fixResults.length);

		const createFileFix = fixResults.find((r) => r.title.indexOf("Create file 'missing.dart'") !== -1);
		assert.ok(createFileFix, "Fix was not found");

		if (!createFileFix.command) {
			// If there's no command, skip the test. This happens very infrequently and appears to be a VS Code
			// race condition. Rather than failing our test runs, skip.
			// TODO: Remove this when https://github.com/microsoft/vscode/issues/86403 is fixed/responded to.
			this.skip();
			return;
		}

		await (vs.commands.executeCommand(createFileFix.command.command, ...createFileFix.command.arguments || [])); // eslint-disable-line @typescript-eslint/no-unsafe-argument

		assert.ok(fs.existsSync(fsPath(missingFile)));
	});

	it("inserts correct indenting for create_method", async function () {
		// Doesn't work for non-LSP due to https://github.com/microsoft/vscode/issues/63129.
		if (!extApi.isLsp)
			this.skip();

		await openFile(emptyFile);
		await setTestContent(`
main() {
	missing();
}
		`);
		const fixResults = await vs.commands.executeCommand<vs.CodeAction[]>("vscode.executeCodeActionProvider", currentDoc().uri, rangeOf("|missing()|"));
		assert.ok(fixResults);
		assert.ok(fixResults.length);

		const createFunctionFix = fixResults.find((r) => r.title.indexOf("Create function 'missing'") !== -1);
		assert.ok(createFunctionFix, "Fix was not found");

		await vs.workspace.applyEdit(createFunctionFix.edit!);

		await ensureTestContent(`
main() {
	missing();
}

void missing() {
}
		`);
	});
});
