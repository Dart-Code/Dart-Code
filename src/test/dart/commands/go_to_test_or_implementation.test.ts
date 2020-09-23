import * as assert from "assert";
import * as fs from "fs";
import * as vs from "vscode";
import { fsPath, tryDeleteFile } from "../../../shared/utils/fs";
import { createTestFileAction, defaultDartTestFileContents } from "../../../shared/utils/test";
import { activate, currentDoc, currentEditor, defer, emptyFile, extApi, helloWorldMainLibFile, helloWorldTestEmptyFile, helloWorldTestMainFile, helloWorldTestTreeFile, openFile, sb, waitForResult } from "../../helpers";
import sinon = require("sinon");

describe("go to test/implementation file", () => {

	beforeEach("activate", () => activate());

	it("command is not available for an unmatched test file", async () => {
		await openFile(helloWorldTestTreeFile);

		// Allow some time to check, because of async stuff.
		await waitForResult(() => extApi.isInTestFileThatHasImplementation === false && extApi.isInImplementationFileThatCanHaveTest === false);

		// Also ensure the command exists.
		const command = (await vs.commands.getCommands(true)).filter((id) => id === "dart.goToTestOrImplementationFile");
		assert.ok(command);
		assert.ok(command.length);
	});

	it("command is available for an unmatched implementation file", async () => {
		await openFile(emptyFile);

		// Allow some time to check, because of async stuff.
		await waitForResult(() => extApi.isInTestFileThatHasImplementation === false && extApi.isInImplementationFileThatCanHaveTest === true);

		// Also ensure the command exists.
		const command = (await vs.commands.getCommands(true)).filter((id) => id === "dart.goToTestOrImplementationFile");
		assert.ok(command);
		assert.ok(command.length);
	});

	it("can create a test file that doesn't already exist", async () => {
		const testFilePath = fsPath(helloWorldTestEmptyFile);
		const testFileRelativePath = "test/empty_test.dart";
		tryDeleteFile(testFilePath);

		const showInformationMessage = sb.stub(vs.window, "showInformationMessage");
		const createNewTestFilePrompt = showInformationMessage
			.withArgs(`Would you like to create a test file at ${testFileRelativePath}?`, sinon.match.any)
			.resolves(createTestFileAction(testFileRelativePath));

		await openFile(emptyFile);

		// Allow some time to check, because of async stuff.
		await waitForResult(() => extApi.isInTestFileThatHasImplementation === false && extApi.isInImplementationFileThatCanHaveTest === true);

		// Also ensure the file doesn't already exist.
		assert.ok(!fs.existsSync(testFilePath));
		defer(() => tryDeleteFile(testFilePath));

		// Run the command as if we clicked it in the context menu.
		await vs.commands.executeCommand("dart.goToTests", emptyFile);

		// Check we were prompted and created the file.
		assert.ok(createNewTestFilePrompt.calledOnce);
		assert.ok(fs.existsSync(testFilePath));

		// Check the file has the correct contents.
		const actual = fs.readFileSync(testFilePath, "utf8");
		const expected = defaultDartTestFileContents("empty");
		assert.equal(actual, expected.contents);

		// Check the file is open and has the correct selection.
		const e = currentEditor();
		assert.equal(e.document.uri.toString(), helloWorldTestEmptyFile.toString());
		assert.equal(e.document.offsetAt(e.selection.start), expected.selectionOffset);
		assert.equal(e.document.offsetAt(e.selection.end) - e.document.offsetAt(e.selection.start), expected.selectionLength);
	});

	it("command is available when in a file with a test", async () => {
		await openFile(helloWorldMainLibFile);

		// Allow some time to check, because of async stuff.
		await waitForResult(() => extApi.isInTestFileThatHasImplementation === false && extApi.isInImplementationFileThatCanHaveTest === true);

		// Also ensure the command exists.
		const command = (await vs.commands.getCommands(true)).filter((id) => id === "dart.goToTestOrImplementationFile");
		assert.ok(command);
		assert.ok(command.length);
	});

	it("can jump from implementation file to test file", async () => {
		await openFile(helloWorldMainLibFile);

		// Allow some time to check, because of async stuff.
		await waitForResult(() => extApi.isInTestFileThatHasImplementation === false && extApi.isInImplementationFileThatCanHaveTest === true);

		await vs.commands.executeCommand("dart.goToTestOrImplementationFile");

		assert.equal(currentDoc().uri.toString(), helloWorldTestMainFile.toString());
	});

	it("command is available when in a file with a matching implementation", async () => {
		await openFile(helloWorldTestMainFile);

		// Allow some time to check, because of async stuff.
		await waitForResult(() => extApi.isInTestFileThatHasImplementation === true && extApi.isInImplementationFileThatCanHaveTest === false);

		// Also ensure the command exists.
		const command = (await vs.commands.getCommands(true)).filter((id) => id === "dart.goToTestOrImplementationFile");
		assert.ok(command);
		assert.ok(command.length);
	});

	it("can jump from test file to implementation file", async () => {
		await openFile(helloWorldTestMainFile);

		// Allow some time to check, because of async stuff.
		await waitForResult(() => extApi.isInTestFileThatHasImplementation === true && extApi.isInImplementationFileThatCanHaveTest === false);

		await vs.commands.executeCommand("dart.goToTestOrImplementationFile");

		assert.equal(currentDoc().uri.toString(), helloWorldMainLibFile.toString());
	});
});
