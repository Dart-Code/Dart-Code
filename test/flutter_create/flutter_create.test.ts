import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import * as vs from "vscode";
import { fsPath } from "../../src/utils";
import { waitFor } from "../helpers";

describe("flutter", () => {
	it("created a basic default project", async () => {
		const basicProjectFolder = fsPath(vs.workspace.workspaceFolders[0].uri);
		const mainFile = path.join(basicProjectFolder, "lib/main.dart");
		// Creating the sample may be a little slow, so allow up to 60 seconds for it.
		await waitFor(() => fs.existsSync(mainFile), "lib/main.dart did not exist", 60000);
		const contents = fs.readFileSync(mainFile);
		assert.notEqual(contents.indexOf("title: 'Flutter Demo'"), -1, `Did not find "title: 'Flutter Demo'" in the sample file`);
	});
	it("created a sample project", async () => {
		const sampleProjectFolder = fsPath(vs.workspace.workspaceFolders[1].uri);
		const mainFile = path.join(sampleProjectFolder, "lib/main.dart");
		// Creating the sample may be a little slow, so allow up to 60 seconds for it.
		await waitFor(() => fs.existsSync(mainFile), "lib/main.dart did not exist", 60000);
		const contents = fs.readFileSync(mainFile);
		assert.notEqual(contents.indexOf("title: 'Flutter Code Sample for scaffold.Scaffold'"), -1, `Did not find "title: 'Flutter Code Sample for scaffold.Scaffold'" in the sample file`);
	});
});
