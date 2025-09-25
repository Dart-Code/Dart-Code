import * as vs from "vscode";
import { Position, Range } from "../interfaces";
import { disposeAll } from "../utils";

export class SingleDocumentPositionTracker implements vs.Disposable {
	// TODO(dantup): Deprecate and remove this in favour of DocumentPositionTracker
	private readonly disposables: vs.Disposable[] = [];
	private readonly tracker: SingleDocumentOffsetTracker = new SingleDocumentOffsetTracker();
	private readonly positionMap: Map<vs.Position, number> = new Map<vs.Position, number>();

	private onPositionsChangedEmitter = new vs.EventEmitter<[vs.TextDocument, Map<vs.Position, vs.Position>]>();
	public readonly onPositionsChanged = this.onPositionsChangedEmitter.event;

	constructor() {
		this.disposables.push(this.tracker);

		this.tracker.onOffsetsChanged(([doc, offsets]) => {
			// Map all our original positions onto new positions based on their
			// new offsets.
			const newPositions = new Map<vs.Position, vs.Position>();
			for (const position of this.positionMap.keys()) {
				const currentOffset = this.positionMap.get(position)!;
				const newOffset = offsets.get(currentOffset);
				if (newOffset)
					newPositions.set(position, doc.positionAt(newOffset));
				else
					newPositions.delete(position);
			}

			this.onPositionsChangedEmitter.fire([doc, newPositions]);
		});
	}

	public clear(): void {
		this.positionMap.clear();
		this.tracker.clear();
	}

	public trackDoc(document: vs.TextDocument, positions: vs.Position[]) {
		// Stash all positions as offsets.
		this.positionMap.clear();
		for (const position of positions)
			this.positionMap.set(position, document.offsetAt(position));

		// Track via the offset tracker.
		this.tracker.trackDoc(document, [...this.positionMap.values()]);
	}

	public dispose() {
		disposeAll(this.disposables);
	}
}

export class SingleDocumentOffsetTracker implements vs.Disposable {
	// TODO(dantup): Deprecate and remove this in favour of DocumentPositionTracker
	private readonly disposables: vs.Disposable[] = [];
	private document: vs.TextDocument | undefined;
	private readonly offsetMap: Map<number, number> = new Map<number, number>();

	private onOffsetsChangedEmitter = new vs.EventEmitter<[vs.TextDocument, Map<number, number>]>();
	public readonly onOffsetsChanged = this.onOffsetsChangedEmitter.event;

	constructor() {
		this.disposables.push(vs.workspace.onDidChangeTextDocument((e) => this.handleUpdate(e)));
	}

	public trackDoc(document: vs.TextDocument, offsets: number[]) {
		this.document = document;
		// Set all offsets to just point to themeselves.
		this.offsetMap.clear();
		for (const offset of offsets)
			this.offsetMap.set(offset, offset);
	}

	public clear(): void {
		this.document = undefined;
		this.offsetMap.clear();
	}

	private handleUpdate(e: vs.TextDocumentChangeEvent) {
		if (e.document !== this.document)
			return;

		for (const offset of [...this.offsetMap.keys()]) {
			// The key (offset) is the original offset, which we must use in the
			// map to track the current offset.
			// updateOffset takes the *value*, since we need to map the "current" (not
			// original) value, and then updates the value in the map.
			const currentOffset = this.offsetMap.get(offset)!;
			const newOffset = this.updateOffset(currentOffset, e);
			if (newOffset)
				this.offsetMap.set(offset, newOffset);
			else
				this.offsetMap.delete(offset);
		}

		this.onOffsetsChangedEmitter.fire([e.document, this.offsetMap]);
	}

	private updateOffset(offset: number, change: vs.TextDocumentChangeEvent): number | undefined {
		// If any edit spans us, consider us deleted.
		if (change.contentChanges.find((edit) => edit.rangeOffset < offset && edit.rangeOffset + edit.rangeLength > offset)) {
			return undefined;
		}

		// Otherwise, shift us along to account for any edits before us.
		const totalDiff = change.contentChanges
			// Edits that end before us.
			.filter((edit) => edit.rangeOffset + edit.rangeLength <= offset)
			// Get the difference in lengths to know if we inserted or removed.
			.map((edit) => edit.text.length - edit.rangeLength)
			.reduce((total, n) => total + n, 0);

		return offset + totalDiff;
	}

	public dispose() {
		disposeAll(this.disposables);
	}
}

interface PositionTrackerEntry {
	offset: number;
	callback: (newPosition: vs.Position | undefined) => void;
	dispose(): void;
}

export class DocumentPositionTracker implements vs.Disposable {
	private readonly disposables: vs.Disposable[] = [];
	private readonly trackers: Map<vs.TextDocument, PositionTrackerEntry[]> = new Map<vs.TextDocument, PositionTrackerEntry[]>();

	constructor() {
		this.disposables.push(vs.workspace.onDidChangeTextDocument((e) => this.handleDocumentChange(e)));
		this.disposables.push(vs.workspace.onDidCloseTextDocument((doc) => this.handleDocumentClose(doc)));
	}

	public trackPosition(document: vs.TextDocument, position: Position, callback: (newPosition: vs.Position | undefined) => void): vs.Disposable {
		const offset = document.offsetAt(new vs.Position(position.line, position.character));
		const entry: PositionTrackerEntry = {
			offset,
			callback,
			dispose: () => {
				const trackers = this.trackers.get(document);
				if (!trackers)
					return;

				const index = trackers.indexOf(entry);
				if (index !== -1) {
					trackers.splice(index, 1);
				}
				if (trackers.length === 0) {
					this.trackers.delete(document);
				}
			}
		};

		if (!this.trackers.has(document)) {
			this.trackers.set(document, []);
		}
		this.trackers.get(document)!.push(entry);

		return entry;
	}

	private handleDocumentChange(e: vs.TextDocumentChangeEvent) {
		const trackers = this.trackers.get(e.document);
		if (!trackers)
			return;

		const trackersToDispose: PositionTrackerEntry[] = [];
		for (const entry of trackers) {
			const newOffset = this.updateOffset(entry.offset, e);

			if (newOffset === undefined) {
				// Position is removed, so will update to undefined and dispose the tracker.
				entry.callback(undefined);
				trackersToDispose.push(entry);
			} else {
				const newPosition = e.document.positionAt(newOffset);
				entry.offset = newOffset;
				entry.callback(newPosition);
			}
		}

		for (const tracker of trackersToDispose) {
			tracker.dispose();
		}
	}

	private handleDocumentClose(doc: vs.TextDocument) {
		const trackers = this.trackers.get(doc);
		if (!trackers)
			return;

		for (const entry of trackers)
			entry.callback(undefined);

		this.trackers.delete(doc);
	}

	private updateOffset(offset: number, change: vs.TextDocumentChangeEvent): number | undefined {
		// If any edit spans us, consider us deleted.
		if (change.contentChanges.find((edit) => edit.rangeOffset < offset && edit.rangeOffset + edit.rangeLength > offset)) {
			return undefined;
		}

		// Otherwise, shift us along to account for any edits before us.
		const totalDiff = change.contentChanges
			// Edits that end before us.
			.filter((edit) => edit.rangeOffset + edit.rangeLength <= offset)
			// Get the difference in lengths to know if we inserted or removed.
			.map((edit) => edit.text.length - edit.rangeLength)
			.reduce((total, n) => total + n, 0);

		return offset + totalDiff;
	}

	public dispose() {
		this.trackers.clear();
		disposeAll(this.disposables);
	}
}

interface RangeTrackerEntry {
	dispose: () => void;
}

export class DocumentRangeTracker implements vs.Disposable {
	private readonly positionTracker = new DocumentPositionTracker();
	private readonly rangeTrackers: RangeTrackerEntry[] = [];

	public trackRange(document: vs.TextDocument, range: Range, callback: (newRange: Range | undefined) => void): vs.Disposable {
		let start: Position | undefined = range.start;
		let end: Position | undefined = range.end;

		const startDisposable = this.positionTracker.trackPosition(document, range.start, (newPos) => {
			start = newPos;
			updateRange();
		});

		const endDisposable = this.positionTracker.trackPosition(document, range.end, (newPos) => {
			end = newPos;
			updateRange();
		});

		const updateRange = () => {
			const newRange = (start && end) ? { start, end } : undefined;
			callback(newRange);

			// If we don't have a range because one position went away, be sure to dispose the other tracker.
			if (!newRange) {
				startDisposable.dispose();
				endDisposable.dispose();
			}
		};

		const entry: RangeTrackerEntry = {
			dispose: () => {
				startDisposable.dispose();
				endDisposable.dispose();
				const index = this.rangeTrackers.indexOf(entry);
				if (index !== -1) {
					this.rangeTrackers.splice(index, 1);
				}
			}
		};

		this.rangeTrackers.push(entry);

		return entry;
	}

	public dispose() {
		this.positionTracker.dispose();
		// We don't need to dispose these manually, because disposing the position tracker
		// already disposes all tracked positions.
		this.rangeTrackers.length = 0;
	}
}
