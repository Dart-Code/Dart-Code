import { strict as assert } from "assert";
import * as fs from "fs";
import * as sinon from "sinon";
import * as vs from "vscode";
import { createFolderForFile, fsPath, tryDeleteFile } from "../../../shared/utils/fs";
import { createTestFileAction, defaultDartTestFileContents } from "../../../shared/utils/test";
import { activate, currentDoc, currentEditor, defer, emptyFile, extApi, helloWorldGoToLibFile, helloWorldGoToLibSrcFile, helloWorldGoToTestFile, helloWorldGoToTestSrcFile, helloWorldMainLibFile, helloWorldTestEmptyFile, helloWorldTestMainFile, helloWorldTestTreeFile, openFile, sb, tryDelete, waitForResult } from "../../helpers";

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
		defer("Delete test file for implementation", () => tryDeleteFile(testFilePath));

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

	function setupTestFiles(files: {
		libFile: boolean,
		libSrcFile: boolean,
		testFile: boolean,
		testSrcFile: boolean,
	}): void {
		createFolderForFile(fsPath(helloWorldGoToLibFile));
		createFolderForFile(fsPath(helloWorldGoToLibSrcFile));
		createFolderForFile(fsPath(helloWorldGoToTestFile));
		createFolderForFile(fsPath(helloWorldGoToTestSrcFile));
		if (files.libFile)
			fs.writeFileSync(fsPath(helloWorldGoToLibFile), "");
		else
			tryDelete(helloWorldGoToLibFile);
		if (files.libSrcFile)
			fs.writeFileSync(fsPath(helloWorldGoToLibSrcFile), "");
		else
			tryDelete(helloWorldGoToLibSrcFile);
		if (files.testFile)
			fs.writeFileSync(fsPath(helloWorldGoToTestFile), "");
		else
			tryDelete(helloWorldGoToTestFile);
		if (files.testSrcFile)
			fs.writeFileSync(fsPath(helloWorldGoToTestSrcFile), "");
		else
			tryDelete(helloWorldGoToTestSrcFile);
	}

	it("can jump from lib/ implementation file to test/ file", async () => {
		setupTestFiles({
			libFile: true,
			libSrcFile: true,
			testFile: true,
			testSrcFile: true,
		});
		await openFile(helloWorldGoToLibFile);

		// Allow some time to check, because of async stuff.
		await waitForResult(() => extApi.isInTestFileThatHasImplementation === false && extApi.isInImplementationFileThatCanHaveTest === true);

		await vs.commands.executeCommand("dart.goToTestOrImplementationFile");

		assert.equal(currentDoc().uri.toString(), helloWorldGoToTestFile.toString());
	});

	it("can jump from lib/src/ implementation file to test/src/ file", async () => {
		setupTestFiles({
			libFile: true,
			libSrcFile: true,
			testFile: true,
			testSrcFile: true,
		});
		await openFile(helloWorldGoToLibSrcFile);

		// Allow some time to check, because of async stuff.
		await waitForResult(() => extApi.isInTestFileThatHasImplementation === false && extApi.isInImplementationFileThatCanHaveTest === true);

		await vs.commands.executeCommand("dart.goToTestOrImplementationFile");

		assert.equal(currentDoc().uri.toString(), helloWorldGoToTestSrcFile.toString());
	});

	it("can jump from lib/src/ implementation file to test/ test file", async () => {
		setupTestFiles({
			libFile: true,
			libSrcFile: true,
			testFile: true,
			testSrcFile: false,
		});

		await openFile(helloWorldGoToLibSrcFile);

		// Allow some time to check, because of async stuff.
		await waitForResult(() => extApi.isInTestFileThatHasImplementation === false && extApi.isInImplementationFileThatCanHaveTest === true);

		await vs.commands.executeCommand("dart.goToTestOrImplementationFile");

		assert.equal(currentDoc().uri.toString(), helloWorldGoToTestFile.toString());
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

	it("can jump from test/ file to lib/ implementation file", async () => {
		setupTestFiles({
			libFile: true,
			libSrcFile: true,
			testFile: true,
			testSrcFile: true,
		});
		await openFile(helloWorldGoToTestFile);

		// Allow some time to check, because of async stuff.
		await waitForResult(() => extApi.isInTestFileThatHasImplementation === true && extApi.isInImplementationFileThatCanHaveTest === false);

		await vs.commands.executeCommand("dart.goToTestOrImplementationFile");

		assert.equal(currentDoc().uri.toString(), helloWorldGoToLibFile.toString());
	});

	it("can jump from test/ file to lib/src/ implementation file", async () => {
		setupTestFiles({
			libFile: false,
			libSrcFile: true,
			testFile: true,
			testSrcFile: true,
		});
		await openFile(helloWorldGoToTestFile);

		// Allow some time to check, because of async stuff.
		await waitForResult(() => extApi.isInTestFileThatHasImplementation === true && extApi.isInImplementationFileThatCanHaveTest === false);

		await vs.commands.executeCommand("dart.goToTestOrImplementationFile");

		assert.equal(currentDoc().uri.toString(), helloWorldGoToLibSrcFile.toString());
	});

	it("can jump from test/src file to lib/src implementation file", async () => {
		setupTestFiles({
			libFile: true,
			libSrcFile: true,
			testFile: true,
			testSrcFile: true,
		});
		await openFile(helloWorldGoToTestSrcFile);

		// Allow some time to check, because of async stuff.
		await waitForResult(() => extApi.isInTestFileThatHasImplementation === true && extApi.isInImplementationFileThatCanHaveTest === false);

		await vs.commands.executeCommand("dart.goToTestOrImplementationFile");

		assert.equal(currentDoc().uri.toString(), helloWorldGoToLibSrcFile.toString());
	});
});
