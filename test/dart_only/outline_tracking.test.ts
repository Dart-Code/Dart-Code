import * as path from "path";
import * as vs from "vscode";
import { OpenFileTracker } from "../../src/analysis/open_file_tracker";
import { fsPath } from "../../src/utils";
import { activate, closeAllOpenFiles, closeFile, helloWorldFolder, openFile, waitFor } from "../helpers";

export const outlineTrackingFile = vs.Uri.file(path.join(fsPath(helloWorldFolder), "lib/outline_tracking/empty.dart"));

describe("file tracker", () => {
	beforeEach("activate", () => activate());

	it("has a tracked outline when a file is opened", async () => {
		await closeAllOpenFiles();
		await waitFor(() => !OpenFileTracker.getOutlineFor(outlineTrackingFile), "Outline was already present");
		await openFile(outlineTrackingFile);
		await waitFor(() => !!OpenFileTracker.getOutlineFor(outlineTrackingFile), "Outline was not added");
	});
	// Skipped because we can't clean up until Code tells us when the editor is closed, which could be
	// up to three minutes :(
	// https://github.com/Microsoft/vscode/issues/15178
	it.skip("has no tracked outline when a file is closed", async () => {
		const doc = await openFile(outlineTrackingFile);
		await waitFor(() => !!OpenFileTracker.getOutlineFor(outlineTrackingFile), "Outline was never present");
		await closeFile(outlineTrackingFile);
		await waitFor(() => !OpenFileTracker.getOutlineFor(outlineTrackingFile), "Outline was not removed");
	});
});
