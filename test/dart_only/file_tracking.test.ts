import * as assert from "assert";
import * as path from "path";
import * as vs from "vscode";
import { OpenFileTracker } from "../../src/analysis/open_file_tracker";
import { fsPath } from "../../src/utils";
import { activate, closeAllOpenFiles, closeFile, helloWorldBrokenFile, helloWorldFolder, helloWorldMainFile, openFile, threeMinutesInMilliseconds, waitFor, waitUntilAllTextDocumentsAreClosed } from "../helpers";

export const outlineTrackingFile = vs.Uri.file(path.join(fsPath(helloWorldFolder), "lib/outline_tracking/empty.dart"));

const file1 = helloWorldBrokenFile;
const file2 = helloWorldMainFile;
const allowSlowSubscriptionTests = true;

describe.only("file tracker", () => {
	beforeEach("activate", () => activate(null));
	it("includes visible editors in the priority list", async () => {
		await closeAllOpenFiles();
		assert.deepStrictEqual(OpenFileTracker.getLastPriorityFiles(), []);
		await openFile(file1);
		assert.deepStrictEqual(OpenFileTracker.getLastPriorityFiles(), [fsPath(file1)]);
	});
	it("excludes open but not-visible editors from the priority list", async () => {
		await closeAllOpenFiles();
		await openFile(file1);
		assert.deepStrictEqual(OpenFileTracker.getLastPriorityFiles(), [fsPath(file1)]);
		// Open a different file, which should replace the previous one as priority.
		await openFile(file2);
		assert.deepStrictEqual(OpenFileTracker.getLastPriorityFiles(), [fsPath(file2)]);
	});
	it("excludes closed editors from the priority list", async () => {
		await closeAllOpenFiles();
		await openFile(file1);
		assert.deepStrictEqual(OpenFileTracker.getLastPriorityFiles(), [fsPath(file1)]);
		await closeFile(file1);
		assert.deepStrictEqual(OpenFileTracker.getLastPriorityFiles(), []);
	});

	describe("subscriptions", function () {
		this.timeout(threeMinutesInMilliseconds + 1000 * 30);

		beforeEach(async function () {
			// These tests are (usually) disabled by default because they're ~3min each.
			// Toggle the bool at top of file when wanting to run them.
			if (!allowSlowSubscriptionTests) {
				this.skip();
				return;
			}
			// Close all files then wait (up to 3 minutes!) for VS Code to mark all docs
			// as closed, as these tests require
			await closeAllOpenFiles();
			await waitUntilAllTextDocumentsAreClosed();
		});
		it("includes visible editors", async () => {
			await openFile(file1);
			assert.deepStrictEqual(OpenFileTracker.getLastSubscribedFiles(), [fsPath(file1)]);
		});
		it("includes open but not-visible editors", async () => {
			// Open first file, which will become visible.
			await openFile(file1);
			assert.deepStrictEqual(OpenFileTracker.getLastSubscribedFiles(), [fsPath(file1)]);

			// Open a different file, which will replace the visible file, but since the original file
			// is still open, should be added to the list.
			await openFile(file2);
			assert.deepStrictEqual(OpenFileTracker.getLastSubscribedFiles(), [fsPath(file1), fsPath(file2)]);
		});
		it("exclude closed editors", async () => {
			// Open a file and ensure it's added.
			await openFile(file1);
			assert.deepStrictEqual(OpenFileTracker.getLastSubscribedFiles(), [fsPath(file1)]);

			// Close the file and ensure it disappears within the expected timeframe (3 minutes!!).
			await closeFile(file1);
			await waitFor(() => OpenFileTracker.getLastSubscribedFiles().length === 0, "Closed file was not removed from subscription list", threeMinutesInMilliseconds);
		});

		it("tracks outlines for open files", async () => {
			await waitFor(() => !OpenFileTracker.getOutlineFor(outlineTrackingFile), "Outline was already present");
			await openFile(outlineTrackingFile);
			await waitFor(() => !!OpenFileTracker.getOutlineFor(outlineTrackingFile), "Outline was not added");
		});
		it("removes tracked outlines when files are closed", async () => {
			// Ensure the outline is present first, else the test is invalid.
			await openFile(outlineTrackingFile);
			await waitFor(() => !!OpenFileTracker.getOutlineFor(outlineTrackingFile), "Outline was never present");

			// Close the file and ensure it disappears within the expected timeframe (3 minutes!!).
			await closeAllOpenFiles();
			await waitFor(() => !OpenFileTracker.getOutlineFor(outlineTrackingFile), "Outline was not removed", threeMinutesInMilliseconds);
		});
	});
});
