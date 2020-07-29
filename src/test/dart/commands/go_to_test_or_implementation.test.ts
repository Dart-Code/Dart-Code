import * as assert from "assert";
import * as vs from "vscode";
import { activate, currentDoc, emptyFile, extApi, helloWorldMainLibFile, helloWorldTestMainFile, helloWorldTestTreeFile, openFile, waitForResult } from "../../helpers";

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
