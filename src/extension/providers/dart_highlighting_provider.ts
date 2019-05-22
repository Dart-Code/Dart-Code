import { CancellationToken, DocumentHighlight, DocumentHighlightProvider, Position, Range, TextDocument } from "vscode";
import { Analyzer } from "../analysis/analyzer";
import { openFileTracker } from "../analysis/open_file_tracker";

export class DartDocumentHighlightProvider implements DocumentHighlightProvider {
	constructor(private readonly analyzer: Analyzer) { }

	public provideDocumentHighlights(
		document: TextDocument, position: Position, token: CancellationToken,
	): DocumentHighlight[] {
		const offset = document.offsetAt(position);
		const occurrences = openFileTracker.getOccurrencesFor(document.uri);
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
