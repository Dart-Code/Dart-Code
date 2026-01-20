import * as path from "path";
import * as vs from "vscode";
import { fsPath } from "../../shared/utils/fs";
import { activate, closeAllOpenFiles, closeFile, forceDocumentCloseEvents, helloWorldFolder, openFile, privateApi, waitForResult } from "../helpers";

export const outlineTrackingFile = vs.Uri.file(path.join(fsPath(helloWorldFolder), "lib/outline_tracking/empty.dart"));

describe("file tracker", () => {
	beforeEach("activate", () => activate(null));

	describe("subscriptions", () => {
		beforeEach(async () => {
			await closeAllOpenFiles();
			await forceDocumentCloseEvents();
		});

		it("tracks outlines for open files", async () => {
			await waitForResult(() => !privateApi.fileTracker.getOutlineFor(outlineTrackingFile), "Outline was already present");
			await openFile(outlineTrackingFile);
			await waitForResult(() => !!privateApi.fileTracker.getOutlineFor(outlineTrackingFile), "Outline was not added");
		});

		it.skip("removes tracked outlines when files are closed", async () => {
			// TODO(dantup): This has never worked since LSP. We don't have any code to clear outlines for closed files.
			//  Need to decide whether we should do that or not.

			// Ensure the outline is present first, else the test is invalid.
			await openFile(outlineTrackingFile);
			await waitForResult(() => !!privateApi.fileTracker.getOutlineFor(outlineTrackingFile), "Outline was never present");

			// Close the file and ensure it disappears.
			await closeFile(outlineTrackingFile);
			await waitForResult(() => !privateApi.fileTracker.getOutlineFor(outlineTrackingFile), "Outline was not removed");
		});
	});
});
