import { CancellationToken, DocumentHighlight, DocumentHighlightProvider, Position, Range, TextDocument } from "vscode";
import { DasFileTracker } from "../analysis/file_tracker_das";

export class DartDocumentHighlightProvider implements DocumentHighlightProvider {
	constructor(private readonly fileTracker: DasFileTracker) {
	}

	public provideDocumentHighlights(
		document: TextDocument, position: Position, token: CancellationToken,
	): DocumentHighlight[] | undefined {
		const offset = document.offsetAt(position);
		const occurrences = this.fileTracker.getOccurrencesFor(document.uri);
		if (!occurrences)
			return;

		for (const occurrence of occurrences) {
			// If an occurence spans our position, then we don't need to look at any others.
			if (occurrence.offsets.find((o) => o <= offset && o + occurrence.length >= offset)) {
				return occurrence.offsets.map((o) => new DocumentHighlight(new Range(
					document.positionAt(o),
					document.positionAt(o + occurrence.length),
				)));
			}
		}
	}
}
