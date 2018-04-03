import * as assert from "assert";
import * as path from "path";
import * as vs from "vscode";
import { ext, activate, closeAllOpenFiles, waitFor, closeFile, everythingFile, helloWorldFolder } from "../helpers";
import { OpenFileTracker } from "../../src/analysis/open_file_tracker";

export const outlineTrackingFile = vs.Uri.file(path.join(helloWorldFolder.fsPath, "lib/outline_tracking/empty.dart"));

describe("file tracker", () => {
	before(() => activate());
	it("has a tracked outline when a file is opened", async () => {
		await closeAllOpenFiles();
		await waitFor(() => !OpenFileTracker.getOutlineFor(outlineTrackingFile), "Outline was already present");
		await vs.workspace.openTextDocument(outlineTrackingFile);
		await waitFor(() => !!OpenFileTracker.getOutlineFor(outlineTrackingFile), "Outline was not removed");
	});
	// Skipped because we can't clean up until Code tells us when the editor is closed, which could be
	// up to three minutes :(
	// https://github.com/Microsoft/vscode/issues/15178
	it.skip("has no tracked outline when a file is closed", async () => {
		const doc = await vs.workspace.openTextDocument(outlineTrackingFile);
		await waitFor(() => !!OpenFileTracker.getOutlineFor(outlineTrackingFile), "Outline was never present");
		await closeFile(outlineTrackingFile);
		await waitFor(() => !OpenFileTracker.getOutlineFor(outlineTrackingFile), "Outline was not added");
	});
});
