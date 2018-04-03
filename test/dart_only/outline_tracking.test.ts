import * as assert from "assert";
import * as vs from "vscode";
import { ext, activate, emptyFile, closeAllOpenFiles, waitFor, closeFile, everythingFile } from "../helpers";
import { OpenFileTracker } from "../../src/analysis/open_file_tracker";

describe("file tracker", () => {
	before(() => activate());
	it("has a tracked outline when a file is opened", async () => {
		console.log("Closing all files");
		await closeAllOpenFiles();
		await waitFor(() => !OpenFileTracker.getOutlineFor(emptyFile), "Outline was already present");
		await vs.workspace.openTextDocument(emptyFile);
		await waitFor(() => !!OpenFileTracker.getOutlineFor(emptyFile));
	});
	it("has no tracked outline when a file is closed", async () => {
		const doc = await vs.workspace.openTextDocument(emptyFile);
		await waitFor(() => !!OpenFileTracker.getOutlineFor(emptyFile), "Outline was never present");
		await closeFile(emptyFile);
		await waitFor(() => !OpenFileTracker.getOutlineFor(emptyFile));
	});
});
