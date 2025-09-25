import { strict as assert } from "assert";
import * as vs from "vscode";
import { Position, Range } from "../../../shared/interfaces";
import { positionsEqual, rangesEqual } from "../../../shared/utils/positions";
import { DocumentPositionTracker, DocumentRangeTracker, SingleDocumentOffsetTracker, SingleDocumentPositionTracker } from "../../../shared/vscode/trackers";
import { activate, closeFile, currentDoc, currentEditor, defer, positionOf, rangeOf, setTestContent } from "../../helpers";

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

		await posTrack.dispose();
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

	it("updates to undefined when document is closed", async () => {
		const tracker = new DocumentPositionTracker();
		defer("Dispose tracker", () => tracker.dispose());

		const doc = await vs.workspace.openTextDocument({ content: "1 22 333 4444 55555", language: "plaintext" });
		await vs.window.showTextDocument(doc);
		let position: Position | undefined = positionOf("^333", doc);

		tracker.trackPosition(doc, position, (newPosition) => position = newPosition);
		await closeFile(doc.uri);

		assert.equal(position, undefined);
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

		await rangeTrack.dispose();
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

	it("updates to undefined when document is closed", async () => {
		const tracker = new DocumentRangeTracker();
		defer("Dispose tracker", () => tracker.dispose());

		const doc = await vs.workspace.openTextDocument({ content: "1 22 333 4444 55555", language: "plaintext" });
		await vs.window.showTextDocument(doc);
		let range: Range | undefined = rangeOf("|333|", doc);

		tracker.trackRange(doc, range, (newRange) => range = newRange);
		await closeFile(doc.uri);

		assert.equal(range, undefined);
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
});
