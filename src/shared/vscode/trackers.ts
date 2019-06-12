import * as vs from "vscode";

export class DocumentPositionTracker implements vs.Disposable {
	private readonly disposables: vs.Disposable[] = [];
	private readonly tracker: DocumentOffsetTracker = new DocumentOffsetTracker();
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
				const currentOffset = this.positionMap.get(position);
				const newOffset = offsets.get(currentOffset);
				if (newOffset)
					newPositions.set(position, doc.positionAt(newOffset));
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
		this.disposables.forEach((s) => s.dispose());
	}
}

export class DocumentOffsetTracker implements vs.Disposable {
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
			const currentOffset = this.offsetMap.get(offset);
			const newOffset = this.updateOffset(currentOffset, e);
			this.offsetMap.set(offset, newOffset);
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
		this.disposables.forEach((s) => s.dispose());
	}
}
