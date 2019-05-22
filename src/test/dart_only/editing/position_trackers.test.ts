import * as assert from "assert";
import { Position, Range } from "vscode";
import { DocumentOffsetTracker, DocumentPositionTracker } from "../../../extension/editing/trackers";
import { activate, currentDoc, currentEditor, positionOf, setTestContent } from "../../helpers";

describe("offset tracker", () => {
	beforeEach("activate emptyFile", () => activate());
	const tracker = new DocumentOffsetTracker();

	it("handles insertions before tracked position", async () => {
		const editor = currentEditor();
		const doc = currentDoc();
		await setTestContent("0123456789");

		const originalOffset = 5;
		tracker.trackDoc(doc, [originalOffset]);

		let updatedValues: Map<number, number> | undefined;
		tracker.onOffsetsChanged(([_, offsetMap]) => updatedValues = offsetMap);

		// Insert a character before our position.
		await editor.edit((eb) => eb.insert(new Position(0, 0), "_"));

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
		await editor.edit((eb) => eb.delete(new Range(new Position(0, 0), new Position(0, 1))));

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
		await editor.edit((eb) => eb.replace(new Range(new Position(0, 0), new Position(0, 1)), "_"));

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
		await editor.edit((eb) => eb.insert(new Position(0, 7), "NEW TEXT"));

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
		await editor.edit((eb) => eb.replace(new Range(new Position(0, 2), new Position(0, 8)), "THIS IS NEW TEXT"));

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
		await editor.edit((eb) => eb.insert(new Position(0, 0), "_"));
		await editor.edit((eb) => eb.insert(new Position(0, 0), "_"));
		await editor.edit((eb) => eb.insert(new Position(0, 0), "_"));
		await editor.edit((eb) => eb.insert(new Position(0, 0), "_"));
		await editor.edit((eb) => eb.insert(new Position(0, 0), "_"));

		assert.ok(updatedValues);
		assert.equal(updatedValues.get(originalOffset), 10);
	});
});

describe("position tracker", () => {
	beforeEach("activate emptyFile", () => activate());

	const tracker = new DocumentPositionTracker();

	it("handles insertions before tracked position", async () => {
		const editor = currentEditor();
		const doc = currentDoc();
		await setTestContent("0123456789");

		const originalPosition = positionOf("4^5");
		tracker.trackDoc(doc, [originalPosition]);

		let updatedValues: Map<Position, Position> | undefined;
		tracker.onPositionsChanged(([_, positionMap]) => updatedValues = positionMap);

		// Insert a character before our position.
		await editor.edit((eb) => eb.insert(new Position(0, 0), "_"));

		assert.ok(updatedValues);
		assert.ok(updatedValues.get(originalPosition).isEqual(positionOf("4^5")));
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
		await editor.edit((eb) => eb.delete(new Range(new Position(0, 0), new Position(0, 1))));

		assert.ok(updatedValues);
		assert.ok(updatedValues.get(originalPosition).isEqual(positionOf("4^5")));
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
		await editor.edit((eb) => eb.replace(new Range(new Position(0, 0), new Position(0, 1)), "_"));

		assert.ok(updatedValues);
		assert.ok(updatedValues.get(originalPosition).isEqual(positionOf("4^5")));
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
		await editor.edit((eb) => eb.insert(new Position(0, 7), "NEW TEXT"));

		assert.ok(updatedValues);
		assert.ok(updatedValues.get(originalPosition).isEqual(positionOf("4^5")));
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
		await editor.edit((eb) => eb.replace(new Range(new Position(0, 2), new Position(0, 8)), "THIS IS NEW TEXT"));

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
		await editor.edit((eb) => eb.insert(new Position(0, 0), "_"));
		await editor.edit((eb) => eb.insert(new Position(0, 0), "_"));
		await editor.edit((eb) => eb.insert(new Position(0, 0), "_"));
		await editor.edit((eb) => eb.insert(new Position(0, 0), "_"));
		await editor.edit((eb) => eb.insert(new Position(0, 0), "_"));

		assert.ok(updatedValues);
		assert.ok(updatedValues.get(originalPosition).isEqual(positionOf("4^5")));
	});
});
