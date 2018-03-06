import {
	DocumentHighlightProvider, DocumentHighlight, TextDocument, Position, CancellationToken, Range,
} from "vscode";
import { Analyzer } from "../analysis/analyzer";
import * as as from "../analysis/analysis_server_types";

export class DartDocumentHighlightProvider implements DocumentHighlightProvider {
	private analyzer: Analyzer;
	constructor(analyzer: Analyzer) {
		this.analyzer = analyzer;
	}

	public provideDocumentHighlights(
		document: TextDocument, position: Position, token: CancellationToken,
	): Thenable<DocumentHighlight[]> {
		const file = document.fileName;
		const offset = document.offsetAt(position);

		return new Promise<DocumentHighlight[]>((resolve, reject) => {
			const disposable = this.analyzer.registerForAnalysisOccurrences((n) => {
				if (n.file !== file)
					return;

				disposable.dispose();

				const highlights: DocumentHighlight[] = [];

				// The analysis server returns all items in the file that can have occurances, and
				// for each item, all the occurances of it in the file. We loop through each item
				// seeing if there's a match for the current cursor position. If there is, we create
				// highlights for those occurances, short circuit the search, and return the results.
				for (const occurrence of n.occurrences) {
					this.buildOccurrences(highlights, document, offset, occurrence);
					if (highlights.length > 0) {
						resolve(highlights);
						return;
					}
				}
				resolve(highlights);
			});

			this.analyzer.forceNotificationsFor(file);
		});
	}

	private buildOccurrences(
		highlights: DocumentHighlight[], document: TextDocument, position: number, occurrences: as.Occurrences,
	) {
		const element = occurrences.element;
		const offsets: number[] = occurrences.offsets;
		const length: number = occurrences.length;

		for (const offset of offsets) {

			// Look for a match in any of the occurance ranges.
			if ((offset <= position) && (position < (offset + length))) {
				// If we get a match, then create highlights for all the items in the matching occurance.
				for (const offset of offsets) {
					const range = new Range(
						document.positionAt(offset),
						document.positionAt(offset + length),
					);
					highlights.push(new DocumentHighlight(range));
				}

				return;
			}
		}
	}

}
