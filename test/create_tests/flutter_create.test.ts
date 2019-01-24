import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import * as vs from "vscode";
import { fsPath } from "../../src/utils";
import { waitForResult } from "../helpers";

describe("flutter", () => {
	it("created a basic default project", async () => {
		const basicProjectFolder = fsPath(vs.workspace.workspaceFolders[0].uri);
		const expectedString = "title: 'Flutter Demo'";
		const mainFile = path.join(basicProjectFolder, "lib", "main.dart");
		// Creating the sample may be a little slow, so allow up to 60 seconds for it.
		await waitForResult(() => fs.existsSync(mainFile), "lib/main.dart did not exist", 60000);
		// Wait for up to 10 seconds for the content to match, as the file may be updated after creation.
		await waitForResult(() => {
			const contents = fs.readFileSync(mainFile);
			return contents.indexOf(expectedString) !== -1;
		}, undefined, 10000, false); // Don't throw on failure, as we have a better assert below that can include the contents.

		const contents = fs.readFileSync(mainFile);
		if (contents.indexOf(expectedString) === -1)
			assert.fail(`Did not find "${expectedString}'" in the sample file:\n\n${contents}`);
	});
	it("created a sample project", async () => {
		const sampleProjectFolder = fsPath(vs.workspace.workspaceFolders[1].uri);
		const expectedString = "title: 'Flutter Code Sample for material.IconButton'";
		const mainFile = path.join(sampleProjectFolder, "lib", "main.dart");
		// Creating the sample may be a little slow, so allow up to 60 seconds for it.
		await waitForResult(() => fs.existsSync(mainFile), "lib/main.dart did not exist", 60000);
		// Wait for up to 10 seconds for the content to match, as the file may be updated after creation.
		await waitForResult(() => {
			const contents = fs.readFileSync(mainFile);
			return contents.indexOf(expectedString) !== -1;
		}, undefined, 10000, false); // Don't throw on failure, as we have a better assert below that can include the contents.

		const contents = fs.readFileSync(mainFile);
		if (contents.indexOf(expectedString) === -1)
			assert.fail(`Did not find "${expectedString}'" in the sample file:\n\n${contents}`);
	});
});
