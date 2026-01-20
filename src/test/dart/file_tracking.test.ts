import { strict as assert } from "assert";
import * as path from "path";
import * as vs from "vscode";
import { fsPath } from "../../shared/utils/fs";
import { activate, closeAllOpenFiles, closeFile, forceDocumentCloseEvents, helloWorldBrokenFile, helloWorldFolder, helloWorldMainFile, openFile, privateApi, threeMinutesInMilliseconds, waitForResult } from "../helpers";

export const outlineTrackingFile = vs.Uri.file(path.join(fsPath(helloWorldFolder), "lib/outline_tracking/empty.dart"));

const file1 = helloWorldBrokenFile;
const file2 = helloWorldMainFile;

describe("file tracker", () => {
	beforeEach("activate", () => activate(null));
	it("includes visible editors in the priority list", async function () {
		if (!privateApi.fileTracker.getLastPriorityFiles)
			this.skip();

		await closeAllOpenFiles();
		assert.deepStrictEqual(privateApi.fileTracker.getLastPriorityFiles(), []);
		await openFile(file1);
		assert.deepStrictEqual(privateApi.fileTracker.getLastPriorityFiles(), [fsPath(file1)]);
	});

	it("excludes open but not-visible editors from the priority list", async function () {
		if (!privateApi.fileTracker.getLastPriorityFiles)
			this.skip();

		await closeAllOpenFiles();
		await openFile(file1);
		assert.deepStrictEqual(privateApi.fileTracker.getLastPriorityFiles(), [fsPath(file1)]);
		// Open a different file, which should replace the previous one as priority.
		await openFile(file2);
		assert.deepStrictEqual(privateApi.fileTracker.getLastPriorityFiles(), [fsPath(file2)]);
	});

	it("excludes closed editors from the priority list", async function () {
		if (!privateApi.fileTracker.getLastPriorityFiles)
			this.skip();

		await closeAllOpenFiles();
		await openFile(file1);
		assert.deepStrictEqual(privateApi.fileTracker.getLastPriorityFiles(), [fsPath(file1)]);
		await closeFile(file1);
		assert.deepStrictEqual(privateApi.fileTracker.getLastPriorityFiles(), []);
	});

	describe("subscriptions", () => {
		beforeEach(async () => {
			await closeAllOpenFiles();
			await forceDocumentCloseEvents();
		});

		it("includes visible editors", async function () {
			if (!privateApi.fileTracker.getLastSubscribedFiles)
				this.skip();

			await openFile(file1);
			assert.deepStrictEqual(privateApi.fileTracker.getLastSubscribedFiles(), [fsPath(file1)]);
		});

		it("includes open but not-visible editors", async function () {
			if (!privateApi.fileTracker.getLastSubscribedFiles)
				this.skip();

			// Open first file, which will become visible.
			await openFile(file1);
			assert.deepStrictEqual(privateApi.fileTracker.getLastSubscribedFiles(), [fsPath(file1)]);

			// Open a different file, which will replace the visible file, but since the original file
			// is still open, should be added to the list.
			await openFile(file2);
			assert.deepStrictEqual(privateApi.fileTracker.getLastSubscribedFiles(), [fsPath(file1), fsPath(file2)]);
		});

		it("exclude closed editors", async function () {
			if (!privateApi.fileTracker.getLastSubscribedFiles)
				this.skip();

			// Open a file and ensure it's added.
			await openFile(file1);
			assert.deepStrictEqual(privateApi.fileTracker.getLastSubscribedFiles(), [fsPath(file1)]);

			// Close the file and ensure it disappears within the expected timeframe (3 minutes!!).
			await closeFile(file1);
			await waitForResult(() => privateApi.fileTracker.getLastSubscribedFiles!().length === 0, "Closed file was not removed from subscription list", threeMinutesInMilliseconds);
		});

		it("tracks outlines for open files", async () => {
			await waitForResult(() => !privateApi.fileTracker.getOutlineFor(outlineTrackingFile), "Outline was already present");
			await openFile(outlineTrackingFile);
			await waitForResult(() => !!privateApi.fileTracker.getOutlineFor(outlineTrackingFile), "Outline was not added");
		});

		it("removes tracked outlines when files are closed", async () => {
			// Ensure the outline is present first, else the test is invalid.
			await openFile(outlineTrackingFile);
			await waitForResult(() => !!privateApi.fileTracker.getOutlineFor(outlineTrackingFile), "Outline was never present");

			// Close the file and ensure it disappears within the expected timeframe (3 minutes!!).
			await closeAllOpenFiles();
			await waitForResult(() => !privateApi.fileTracker.getOutlineFor(outlineTrackingFile), "Outline was not removed", threeMinutesInMilliseconds);
		});
	});
});
