import { strict as assert } from "assert";
import * as fs from "fs";
import * as path from "path";
import * as vs from "vscode";
import { Position, Range } from "../../../shared/interfaces";
import { fsPath } from "../../../shared/utils/fs";
import { positionsEqual, rangesEqual } from "../../../shared/utils/positions";
import { waitFor } from "../../../shared/utils/promises";
import { DocumentPositionTracker, DocumentRangeTracker, SingleDocumentOffsetTracker, SingleDocumentPositionTracker } from "../../../shared/vscode/trackers";
import { activate, closeFile, currentDoc, currentEditor, defer, delay, helloWorldFolder, positionOf, rangeOf, setTestContent, tryDelete } from "../../helpers";

describe("offset tracker", () => {
	beforeEach("activate emptyFile", () => activate());
	const tracker = new SingleDocumentOffsetTracker();

	it("handles insertions before tracked position", async () => {
		const editor = currentEditor();
		const doc = currentDoc();
		await setTestContent("0123456789");

		const originalOffset = 5;
		tracker.trackDoc(doc, [originalOffset]);

		let updatedValues: Map<number, number> | undefined;
		tracker.onOffsetsChanged(([_, offsetMap]) => updatedValues = offsetMap);

		// Insert a character before our position.
		await editor.edit((eb) => eb.insert(new vs.Position(0, 0), "_"));

		assert.ok(updatedValues);
		assert.equal(updatedValues.get(originalOffset), 6);
	});

	it("handles deletes before tracked position", async () => {
		const editor = currentEditor();
		const doc = currentDoc();
		await setTestContent("0123456789");

		const originalOffset = 5;
		tracker.trackDoc(doc, [originalOffset]);

		let updatedValues: Map<number, number> | undefined;
		tracker.onOffsetsChanged(([_, offsetMap]) => updatedValues = offsetMap);

		// Delete a character before our position.
		await editor.edit((eb) => eb.delete(new vs.Range(new vs.Position(0, 0), new vs.Position(0, 1))));

		assert.ok(updatedValues);
		assert.equal(updatedValues.get(originalOffset), 4);
	});

	it("handles same-length edits before tracked position", async () => {
		const editor = currentEditor();
		const doc = currentDoc();
		await setTestContent("0123456789");

		const originalOffset = 5;
		tracker.trackDoc(doc, [originalOffset]);

		let updatedValues: Map<number, number> | undefined;
		tracker.onOffsetsChanged(([_, offsetMap]) => updatedValues = offsetMap);

		// Replace a character before our position.
		await editor.edit((eb) => eb.replace(new vs.Range(new vs.Position(0, 0), new vs.Position(0, 1)), "_"));

		assert.ok(updatedValues);
		assert.equal(updatedValues.get(originalOffset), originalOffset);
	});

	it("ignores edits after tracked position", async () => {
		const editor = currentEditor();
		const doc = currentDoc();
		await setTestContent("0123456789");

		const originalOffset = 5;
		tracker.trackDoc(doc, [originalOffset]);

		let updatedValues: Map<number, number> | undefined;
		tracker.onOffsetsChanged(([_, offsetMap]) => updatedValues = offsetMap);

		// Insert text after our position.
		await editor.edit((eb) => eb.insert(new vs.Position(0, 7), "NEW TEXT"));

		assert.ok(updatedValues);
		assert.equal(updatedValues.get(originalOffset), originalOffset);
	});

	it("returns undefined if position was swallowed by an edit", async () => {
		const editor = currentEditor();
		const doc = currentDoc();
		await setTestContent("0123456789");

		const originalOffset = 5;
		tracker.trackDoc(doc, [originalOffset]);

		let updatedValues: Map<number, number> | undefined;
		tracker.onOffsetsChanged(([_, offsetMap]) => updatedValues = offsetMap);

		// Insert text after our position.
		await editor.edit((eb) => eb.replace(new vs.Range(new vs.Position(0, 2), new vs.Position(0, 8)), "THIS IS NEW TEXT"));

		assert.ok(updatedValues);
		assert.equal(updatedValues.get(originalOffset), undefined);
	});

	it("handles multiple edits", async () => {
		const editor = currentEditor();
		const doc = currentDoc();
		await setTestContent("0123456789");

		const originalOffset = 5;
		tracker.trackDoc(doc, [originalOffset]);

		let updatedValues: Map<number, number> | undefined;
		tracker.onOffsetsChanged(([_, offsetMap]) => updatedValues = offsetMap);

		// Make multiple edits so that we still expect to key using the original
		// offset but the value is updated based on its current value each time.
		await editor.edit((eb) => eb.insert(new vs.Position(0, 0), "_"));
		await editor.edit((eb) => eb.insert(new vs.Position(0, 0), "_"));
		await editor.edit((eb) => eb.insert(new vs.Position(0, 0), "_"));
		await editor.edit((eb) => eb.insert(new vs.Position(0, 0), "_"));
		await editor.edit((eb) => eb.insert(new vs.Position(0, 0), "_"));

		assert.ok(updatedValues);
		assert.equal(updatedValues.get(originalOffset), 10);
	});
});

describe("position tracker", () => {
	beforeEach("activate emptyFile", () => activate());

	const tracker = new SingleDocumentPositionTracker();

	it("handles insertions before tracked position", async () => {
		const editor = currentEditor();
		const doc = currentDoc();
		await setTestContent("0123456789");

		const originalPosition = positionOf("4^5");
		tracker.trackDoc(doc, [originalPosition]);

		let updatedValues: Map<Position, Position> | undefined;
		tracker.onPositionsChanged(([_, positionMap]) => updatedValues = positionMap);

		// Insert a character before our position.
		await editor.edit((eb) => eb.insert(new vs.Position(0, 0), "_"));

		assert.ok(updatedValues);
		assert.ok(positionsEqual(updatedValues.get(originalPosition)!, positionOf("4^5")));
	});

	it("handles deletes before tracked position", async () => {
		const editor = currentEditor();
		const doc = currentDoc();
		await setTestContent("0123456789");

		const originalPosition = positionOf("4^5");
		tracker.trackDoc(doc, [originalPosition]);

		let updatedValues: Map<Position, Position> | undefined;
		tracker.onPositionsChanged(([_, positionMap]) => updatedValues = positionMap);

		// Delete a character before our position.
		await editor.edit((eb) => eb.delete(new vs.Range(new vs.Position(0, 0), new vs.Position(0, 1))));

		assert.ok(updatedValues);
		assert.ok(positionsEqual(updatedValues.get(originalPosition)!, positionOf("4^5")));
	});

	it("handles same-length edits before tracked position", async () => {
		const editor = currentEditor();
		const doc = currentDoc();
		await setTestContent("0123456789");

		const originalPosition = positionOf("4^5");
		tracker.trackDoc(doc, [originalPosition]);

		let updatedValues: Map<Position, Position> | undefined;
		tracker.onPositionsChanged(([_, positionMap]) => updatedValues = positionMap);

		// Replace a character before our position.
		await editor.edit((eb) => eb.replace(new vs.Range(new vs.Position(0, 0), new vs.Position(0, 1)), "_"));

		assert.ok(updatedValues);
		assert.ok(positionsEqual(updatedValues.get(originalPosition)!, positionOf("4^5")));
	});

	it("ignores edits after tracked position", async () => {
		const editor = currentEditor();
		const doc = currentDoc();
		await setTestContent("0123456789");

		const originalPosition = positionOf("4^5");
		tracker.trackDoc(doc, [originalPosition]);

		let updatedValues: Map<Position, Position> | undefined;
		tracker.onPositionsChanged(([_, positionMap]) => updatedValues = positionMap);

		// Insert text after our position.
		await editor.edit((eb) => eb.insert(new vs.Position(0, 7), "NEW TEXT"));

		assert.ok(updatedValues);
		assert.ok(positionsEqual(updatedValues.get(originalPosition)!, positionOf("4^5")));
	});

	it("returns undefined if position was swallowed by an edit", async () => {
		const editor = currentEditor();
		const doc = currentDoc();
		await setTestContent("0123456789");

		const originalPosition = positionOf("4^5");
		tracker.trackDoc(doc, [originalPosition]);

		let updatedValues: Map<Position, Position> | undefined;
		tracker.onPositionsChanged(([_, positionMap]) => updatedValues = positionMap);

		// Insert text after our position.
		await editor.edit((eb) => eb.replace(new vs.Range(new vs.Position(0, 2), new vs.Position(0, 8)), "THIS IS NEW TEXT"));

		assert.ok(updatedValues);
		assert.equal(updatedValues.get(originalPosition), undefined);
	});

	it("handles multiple edits", async () => {
		const editor = currentEditor();
		const doc = currentDoc();
		await setTestContent("0123456789");

		const originalPosition = positionOf("4^5");
		tracker.trackDoc(doc, [originalPosition]);

		let updatedValues: Map<Position, Position> | undefined;
		tracker.onPositionsChanged(([_, positionMap]) => updatedValues = positionMap);

		// Make multiple edits so that we still expect to key using the original
		// offset but the value is updated based on its current value each time.
		await editor.edit((eb) => eb.insert(new vs.Position(0, 0), "_"));
		await editor.edit((eb) => eb.insert(new vs.Position(0, 0), "_"));
		await editor.edit((eb) => eb.insert(new vs.Position(0, 0), "_"));
		await editor.edit((eb) => eb.insert(new vs.Position(0, 0), "_"));
		await editor.edit((eb) => eb.insert(new vs.Position(0, 0), "_"));

		assert.ok(updatedValues);
		assert.ok(positionsEqual(updatedValues.get(originalPosition)!, positionOf("4^5")));
	});
});

describe("multi-document position tracker", () => {
	beforeEach("activate", () => activate(null));

	it("tracks changes in multiple documents", async () => {
		const tracker = new DocumentPositionTracker();
		defer("Dispose tracker", () => tracker.dispose());

		const doc1 = await vs.workspace.openTextDocument({ content: "1 22 333 4444 55555", language: "plaintext" });
		const editor1 = await vs.window.showTextDocument(doc1);
		let position1: Position | undefined = positionOf("^333", doc1);

		const doc2 = await vs.workspace.openTextDocument({ content: "1 22 333 4444 55555", language: "plaintext" });
		let position2: Position | undefined = positionOf("^4444", doc2);

		// Set up trackers for both documents.
		tracker.trackPosition(doc1, position1, (newPosition) => position1 = newPosition);
		tracker.trackPosition(doc2, position2, (newPosition) => position2 = newPosition);

		// Apply insert, replace, delete before and after in the first doc.
		await editor1.edit((eb) => {
			eb.insert(positionOf("^1", doc1), "inserted at start");
			eb.insert(positionOf("55555^", doc1), "inserted at end");
		});
		await editor1.edit((eb) => {
			eb.replace(rangeOf("|22|", doc1), "-2-2");
			eb.replace(rangeOf("|4444|", doc1), "-4-4-4-4");
		});
		await editor1.edit((eb) => {
			eb.delete(rangeOf("| at start|", doc1));
			eb.delete(rangeOf("| at end|", doc1));
		});

		// Tracked positions should still match locations where the original text was.
		assert.ok(positionsEqual(position1, positionOf("^333", doc1)));
		assert.ok(positionsEqual(position2, positionOf("^4444", doc2)));
	});

	it("handles multi-line insertions before tracked position", async () => {
		const tracker = new DocumentPositionTracker();
		defer("Dispose tracker", () => tracker.dispose());

		const doc = await vs.workspace.openTextDocument({ content: "line1\nline2\nline3", language: "plaintext" });
		const editor = await vs.window.showTextDocument(doc);
		let position: Position | undefined = positionOf("^line3", doc);

		tracker.trackPosition(doc, position, (newPosition) => position = newPosition);

		// Insert a newline at the start of the doc.
		await editor.edit((eb) => eb.insert(new vs.Position(0, 0), "\n"));

		// The tracked position should still be at the start of line 3.
		assert.ok(positionsEqual(position, positionOf("^line3", doc)));
	});

	it("stops tracking when individual track is disposed", async () => {
		const tracker = new DocumentPositionTracker();
		defer("Dispose tracker", () => tracker.dispose());

		const doc = await vs.workspace.openTextDocument({ content: "1 22 333 4444 55555", language: "plaintext" });
		const editor = await vs.window.showTextDocument(doc);
		let position: Position | undefined = positionOf("^333", doc);

		// Set up multiple trackers for the same position.
		const posTrack = tracker.trackPosition(doc, position, (newPosition) => position = newPosition);

		// Did update
		await editor.edit((eb) => eb.insert(positionOf("^1", doc), "inserted at start"));
		assert.ok(positionsEqual(position, positionOf("^333", doc)));

		posTrack.dispose();
		await editor.edit((eb) => eb.insert(positionOf("^1", doc), "000"));
		assert.ok(positionsEqual(position, positionOf("^22 3", doc))); // Was not tracked, so is out of sync.
	});

	it("stops tracking when whole tracker is disposed", async () => {
		const tracker = new DocumentPositionTracker();
		defer("Dispose tracker", () => tracker.dispose());

		const doc = await vs.workspace.openTextDocument({ content: "1 22 333 4444 55555", language: "plaintext" });
		const editor = await vs.window.showTextDocument(doc);
		let position: Position | undefined = positionOf("^333", doc);

		// Set up multiple trackers for the same position.
		tracker.trackPosition(doc, position, (newPosition) => position = newPosition);

		// Did update
		await editor.edit((eb) => eb.insert(positionOf("^1", doc), "inserted at start"));
		assert.ok(positionsEqual(position, positionOf("^333", doc)));

		tracker.dispose();
		await editor.edit((eb) => eb.insert(positionOf("^1", doc), "000"));
		assert.ok(positionsEqual(position, positionOf("^22 3", doc))); // Was not tracked, so is out of sync.
	});

	it("can track the same position multiple times", async () => {
		const tracker = new DocumentPositionTracker();
		defer("Dispose tracker", () => tracker.dispose());

		const doc = await vs.workspace.openTextDocument({ content: "1 22 333 4444 55555", language: "plaintext" });
		const editor = await vs.window.showTextDocument(doc);
		let position1: Position | undefined = positionOf("^333", doc);
		let position2: Position | undefined = position1;

		// Set up multiple trackers for the same position.
		tracker.trackPosition(doc, position1, (newPosition) => position1 = newPosition);
		tracker.trackPosition(doc, position2, (newPosition) => position2 = newPosition);

		await editor.edit((eb) => eb.insert(positionOf("^1", doc), "inserted at start"));

		// Both tracked positions should've been updated.
		assert.ok(positionsEqual(position1, positionOf("^333", doc)));
		assert.ok(positionsEqual(position2, position1));
	});

	it("handles documents being closed and re-opened", async () => {
		const tracker = new DocumentPositionTracker();
		defer("Dispose tracker", () => tracker.dispose());

		const retainedFile = vs.Uri.file(path.join(fsPath(helloWorldFolder), "tracker_test.txt"));
		const diskModMixedFile = vs.Uri.file(path.join(fsPath(helloWorldFolder), "tracker_test_disk_mod_mixed.txt"));
		const diskModNewlineFile = vs.Uri.file(path.join(fsPath(helloWorldFolder), "tracker_test_disk_mod_newline.txt"));

		fs.writeFileSync(fsPath(retainedFile), Buffer.from("1 22 333 4444 55555"));
		fs.writeFileSync(fsPath(diskModMixedFile), Buffer.from("12345"));
		fs.writeFileSync(fsPath(diskModNewlineFile), Buffer.from("12345"));
		defer("Delete test files", () => {
			tryDelete(retainedFile);
			tryDelete(diskModMixedFile);
			tryDelete(diskModNewlineFile);
		});

		// Case 1: Retains tracking when document is closed and re-opened without external modification.
		const retainedDoc = await vs.workspace.openTextDocument(retainedFile);
		await vs.window.showTextDocument(retainedDoc);
		let retainedPos: Position | undefined = positionOf("^333", retainedDoc);
		tracker.trackPosition(retainedDoc, retainedPos, (newPosition) => retainedPos = newPosition);

		// Case 2: Invalidates all trackers if any become invalid references on disk while closed.
		const mixedDoc = await vs.workspace.openTextDocument(diskModMixedFile);
		await vs.window.showTextDocument(mixedDoc);
		let mixedPos1: Position | undefined = positionOf("^1", mixedDoc);
		let mixedPos5: Position | undefined = positionOf("^5", mixedDoc);
		tracker.trackPosition(mixedDoc, mixedPos1, (newPosition) => mixedPos1 = newPosition);
		tracker.trackPosition(mixedDoc, mixedPos5, (newPosition) => mixedPos5 = newPosition);

		// Case 3: Invalidates all trackers if file is modified externally causing position mismatch.
		const newlineDoc = await vs.workspace.openTextDocument(diskModNewlineFile);
		await vs.window.showTextDocument(newlineDoc);
		let newlinePos1: Position | undefined = positionOf("^3", newlineDoc);
		tracker.trackPosition(newlineDoc, newlinePos1, (newPosition) => newlinePos1 = newPosition);

		// Close all three documents with a single forceDocumentCloseEvents pass.
		await vs.commands.executeCommand("workbench.action.closeAllEditors");
		await closeFile(diskModNewlineFile);

		// Modify files on disk while closed:
		// Case 2: Shorter ("123") so mixedPos1 is still valid, mixedPos5 is invalid.
		fs.writeFileSync(fsPath(diskModMixedFile), Buffer.from("123"));
		// Case 3: Include a newline at the start so offsets are valid, but position for offset has changed.
		fs.writeFileSync(fsPath(diskModNewlineFile), Buffer.from("\n12345"));
		await delay(10);

		// Verify Case 1: Should not become undefined, and should track edits after re-open.
		assert.ok(retainedPos);
		const retainedDoc2 = await vs.workspace.openTextDocument(retainedFile);
		const retainedEditor2 = await vs.window.showTextDocument(retainedDoc2);
		await retainedEditor2.edit((eb) => eb.insert(new vs.Position(0, 0), "start "));
		assert.ok(positionsEqual(retainedPos, positionOf("start 1 22 ^333 4444 55555", retainedDoc2)));

		// Verify Case 2: Re-open and verify both tracked positions become undefined.
		await vs.workspace.openTextDocument(diskModMixedFile);
		await waitFor(() => mixedPos1 === undefined && mixedPos5 === undefined);
		assert.equal(mixedPos1, undefined);
		assert.equal(mixedPos5, undefined);

		// Verify Case 3: Re-open and verify tracked position becomes undefined because offset->position changed.
		await vs.workspace.openTextDocument(diskModNewlineFile);
		await waitFor(() => newlinePos1 === undefined);
		assert.equal(newlinePos1, undefined);
	});

	it("updates to undefined if text is deleted", async () => {
		const tracker = new DocumentPositionTracker();
		defer("Dispose tracker", () => tracker.dispose());

		const doc = await vs.workspace.openTextDocument({ content: "1 22 333 4444 55555", language: "plaintext" });
		const editor = await vs.window.showTextDocument(doc);
		let position: Position | undefined = positionOf("^333", doc);

		tracker.trackPosition(doc, position, (newPosition) => position = newPosition);

		await editor.edit((eb) => eb.delete(rangeOf("| 333 |", doc)));

		assert.equal(position, undefined);
	});
});

describe("multi-document range tracker", () => {
	beforeEach("activate", () => activate(null));

	it("tracks changes in multiple documents", async () => {
		const tracker = new DocumentRangeTracker();
		defer("Dispose tracker", () => tracker.dispose());

		const doc1 = await vs.workspace.openTextDocument({ content: "1 22 333 4444 55555", language: "plaintext" });
		const editor1 = await vs.window.showTextDocument(doc1);
		let range1: Range | undefined = rangeOf("|333|", doc1);

		const doc2 = await vs.workspace.openTextDocument({ content: "1 22 333 4444 55555", language: "plaintext" });
		let range2: Range | undefined = rangeOf("|4444|", doc2);

		// Set up trackers for both documents.
		tracker.trackRange(doc1, range1, (newRange) => range1 = newRange);
		tracker.trackRange(doc2, range2, (newRange) => range2 = newRange);

		// Apply insert, replace, delete before and after in the first doc.
		await editor1.edit((eb) => {
			eb.insert(positionOf("^1", doc1), "inserted at start");
			eb.insert(positionOf("55555^", doc1), "inserted at end");
		});
		await editor1.edit((eb) => {
			eb.replace(rangeOf("|22|", doc1), "-2-2");
			eb.replace(rangeOf("|4444|", doc1), "-4-4-4-4");
		});
		await editor1.edit((eb) => {
			eb.delete(rangeOf("| at start|", doc1));
			eb.delete(rangeOf("| at end|", doc1));
		});

		// Tracked ranges should still match locations where the original text was.
		assert.ok(rangesEqual(range1, rangeOf("|333|", doc1)));
		assert.ok(rangesEqual(range2, rangeOf("|4444|", doc2)));
	});

	it("handles multi-line insertions before tracked range", async () => {
		const tracker = new DocumentRangeTracker();
		defer("Dispose tracker", () => tracker.dispose());

		const doc = await vs.workspace.openTextDocument({ content: "line1\nline2\nline3", language: "plaintext" });
		const editor = await vs.window.showTextDocument(doc);
		let range: Range | undefined = rangeOf("|line3|", doc);

		tracker.trackRange(doc, range, (newRange) => range = newRange);

		// Insert a newline at the start of the doc.
		await editor.edit((eb) => eb.insert(new vs.Position(0, 0), "\n"));

		// The tracked range should still be around "line3".
		assert.ok(rangesEqual(range, rangeOf("|line3|", doc)));
	});

	it("stops tracking when individual track is disposed", async () => {
		const tracker = new DocumentRangeTracker();
		defer("Dispose tracker", () => tracker.dispose());

		const doc = await vs.workspace.openTextDocument({ content: "1 22 333 4444 55555", language: "plaintext" });
		const editor = await vs.window.showTextDocument(doc);
		let range: Range | undefined = rangeOf("|333|", doc);

		// Set up tracker for the range.
		const rangeTrack = tracker.trackRange(doc, range, (newRange) => range = newRange);

		// Did update
		await editor.edit((eb) => eb.insert(positionOf("^1", doc), "inserted at start"));
		assert.ok(rangesEqual(range, rangeOf("|333|", doc)));

		rangeTrack.dispose();
		await editor.edit((eb) => eb.insert(positionOf("^1", doc), "000"));
		assert.ok(rangesEqual(range, rangeOf("|22 |", doc))); // Was not tracked, so is out of sync.
	});

	it("stops tracking when whole tracker is disposed", async () => {
		const tracker = new DocumentRangeTracker();
		defer("Dispose tracker", () => tracker.dispose());

		const doc = await vs.workspace.openTextDocument({ content: "1 22 333 4444 55555", language: "plaintext" });
		const editor = await vs.window.showTextDocument(doc);
		let range: Range | undefined = rangeOf("|333|", doc);

		// Set up tracker for the range.
		tracker.trackRange(doc, range, (newRange) => range = newRange);

		// Did update
		await editor.edit((eb) => eb.insert(positionOf("^1", doc), "inserted at start"));
		assert.ok(rangesEqual(range, rangeOf("|333|", doc)));

		tracker.dispose();
		await editor.edit((eb) => eb.insert(positionOf("^1", doc), "000"));
		assert.ok(rangesEqual(range, rangeOf("|22 |", doc))); // Was not tracked, so is out of sync.
	});

	it("can track the same range multiple times", async () => {
		const tracker = new DocumentRangeTracker();
		defer("Dispose tracker", () => tracker.dispose());

		const doc = await vs.workspace.openTextDocument({ content: "1 22 333 4444 55555", language: "plaintext" });
		const editor = await vs.window.showTextDocument(doc);
		let range1: Range | undefined = rangeOf("|333|", doc);
		let range2: Range | undefined = range1;

		// Set up multiple trackers for the same range.
		tracker.trackRange(doc, range1, (newRange) => range1 = newRange);
		tracker.trackRange(doc, range2, (newRange) => range2 = newRange);

		await editor.edit((eb) => eb.insert(positionOf("^1", doc), "inserted at start"));

		// Both tracked ranges should've been updated.
		assert.ok(rangesEqual(range1, rangeOf("|333|", doc)));
		assert.ok(rangesEqual(range2, range1));
	});

	it("handles documents being closed and re-opened", async () => {
		const tracker = new DocumentRangeTracker();
		defer("Dispose tracker", () => tracker.dispose());

		const retainedFile = vs.Uri.file(path.join(fsPath(helloWorldFolder), "tracker_test_range.txt"));
		const diskModMixedFile = vs.Uri.file(path.join(fsPath(helloWorldFolder), "tracker_test_disk_mod_range.txt"));
		const diskModNewlineFile = vs.Uri.file(path.join(fsPath(helloWorldFolder), "tracker_test_disk_mod_newline_range.txt"));

		fs.writeFileSync(fsPath(retainedFile), Buffer.from("1 22 333 4444 55555"));
		fs.writeFileSync(fsPath(diskModMixedFile), Buffer.from("12345"));
		fs.writeFileSync(fsPath(diskModNewlineFile), Buffer.from("12345"));
		defer("Delete test files", () => {
			tryDelete(retainedFile);
			tryDelete(diskModMixedFile);
			tryDelete(diskModNewlineFile);
		});

		// Case 1: Retains tracking when document is closed and re-opened without external modification.
		const retainedDoc = await vs.workspace.openTextDocument(retainedFile);
		await vs.window.showTextDocument(retainedDoc);
		let retainedRange: Range | undefined = rangeOf("|333|", retainedDoc);
		tracker.trackRange(retainedDoc, retainedRange, (newRange) => retainedRange = newRange);

		// Case 2: Invalidates all trackers if any become invalid references on disk while closed.
		const mixedDoc = await vs.workspace.openTextDocument(diskModMixedFile);
		await vs.window.showTextDocument(mixedDoc);
		let mixedRange1: Range | undefined = rangeOf("|1|", mixedDoc);
		let mixedRange5: Range | undefined = rangeOf("|5|", mixedDoc);
		tracker.trackRange(mixedDoc, mixedRange1, (newRange) => mixedRange1 = newRange);
		tracker.trackRange(mixedDoc, mixedRange5, (newRange) => mixedRange5 = newRange);

		// Case 3: Invalidates all range trackers if file is modified externally causing position mismatch.
		const newlineDoc = await vs.workspace.openTextDocument(diskModNewlineFile);
		await vs.window.showTextDocument(newlineDoc);
		let newlineRange: Range | undefined = rangeOf("|1|", newlineDoc);
		tracker.trackRange(newlineDoc, newlineRange, (newRange) => newlineRange = newRange);

		// Close all three documents with a single forceDocumentCloseEvents pass.
		await vs.commands.executeCommand("workbench.action.closeAllEditors");
		await closeFile(diskModNewlineFile);

		// Modify files on disk while closed:
		// Case 2: Shorter ("123") so mixedRange1 is still valid, mixedRange5 is invalid.
		fs.writeFileSync(fsPath(diskModMixedFile), Buffer.from("123"));
		// Case 3: Include a newline at the start so offsets are valid, but positions are not.
		fs.writeFileSync(fsPath(diskModNewlineFile), Buffer.from("\n12345"));
		await delay(10);

		// Verify Case 1: Should not become undefined, and should track edits after re-open.
		assert.ok(retainedRange);
		const retainedDoc2 = await vs.workspace.openTextDocument(retainedFile);
		const retainedEditor2 = await vs.window.showTextDocument(retainedDoc2);
		await retainedEditor2.edit((eb) => eb.insert(new vs.Position(0, 0), "start "));
		assert.ok(rangesEqual(retainedRange, rangeOf("|333|", retainedDoc2)));

		// Verify Case 2: Re-open and verify both tracked ranges become undefined.
		await vs.workspace.openTextDocument(diskModMixedFile);
		await waitFor(() => mixedRange1 === undefined && mixedRange5 === undefined);
		assert.equal(mixedRange1, undefined);
		assert.equal(mixedRange5, undefined);

		// Verify Case 3: Re-open and verify tracked range becomes undefined because offset->position changed.
		await vs.workspace.openTextDocument(diskModNewlineFile);
		await waitFor(() => newlineRange === undefined);
		assert.equal(newlineRange, undefined);
	});

	it("updates to undefined if text is deleted", async () => {
		const tracker = new DocumentRangeTracker();
		defer("Dispose tracker", () => tracker.dispose());

		const doc = await vs.workspace.openTextDocument({ content: "1 22 333 4444 55555", language: "plaintext" });
		const editor = await vs.window.showTextDocument(doc);
		let range: Range | undefined = rangeOf("|333|", doc);

		tracker.trackRange(doc, range, (newRange) => range = newRange);

		await editor.edit((eb) => eb.delete(rangeOf("| 333 |", doc)));

		assert.equal(range, undefined);
	});

	it("handles deletion of one tracked range without messing up the next - issue 5831", async () => {
		const tracker = new DocumentRangeTracker();
		defer("Dispose tracker", () => tracker.dispose());

		const doc = await vs.workspace.openTextDocument({ content: "1 22 333 4444 55555", language: "plaintext" });
		const editor = await vs.window.showTextDocument(doc);
		let range1: Range | undefined = rangeOf("|22|", doc);
		let range2: Range | undefined = rangeOf("|4444|", doc);

		// Set up trackers for both ranges.
		tracker.trackRange(doc, range1, (newRange) => range1 = newRange);
		tracker.trackRange(doc, range2, (newRange) => range2 = newRange);

		// Delete the text for the first range (including surrounding spaces to ensure it's deleted).
		await editor.edit((eb) => eb.delete(rangeOf("| 22 |", doc)));

		// The first range should be undefined (deleted).
		assert.equal(range1, undefined);

		// The second range should still be tracked and correct.
		assert.ok(rangesEqual(range2, rangeOf("|4444|", doc)));
	});
});
