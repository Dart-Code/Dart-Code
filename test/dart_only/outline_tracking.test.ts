import * as assert from "assert";
import * as vs from "vscode";
import { ext, activate, emptyFile, closeAllOpenFiles, waitFor, closeFile } from "../helpers";
import { OpenFileTracker } from "../../src/analysis/open_file_tracker";

describe("file tracker", () => {
	before(() => activate());
	before(() => closeAllOpenFiles());
	it("has a tracked outline when a file is opened", async () => {
		assert.ok(!OpenFileTracker.getOutlineFor(emptyFile));
		await vs.workspace.openTextDocument(emptyFile);
		waitFor(() => !!OpenFileTracker.getOutlineFor(emptyFile));
	});
	it("has no tracked outline when a file is closed", async () => {
		const doc = await vs.workspace.openTextDocument(emptyFile);
		waitFor(() => !!OpenFileTracker.getOutlineFor(emptyFile));
		await closeFile(emptyFile);
		waitFor(() => !OpenFileTracker.getOutlineFor(emptyFile));
	});
});
