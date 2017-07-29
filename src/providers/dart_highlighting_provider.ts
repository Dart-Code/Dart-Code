"use strict";

import {
	DocumentHighlightProvider, DocumentHighlight, TextDocument, Position, CancellationToken, Range
} from "vscode";
import { Analyzer } from "../analysis/analyzer";
import * as as from "../analysis/analysis_server_types";

export class DartDocumentHighlightProvider implements DocumentHighlightProvider {
	private analyzer: Analyzer;
	constructor(analyzer: Analyzer) {
		this.analyzer = analyzer;
	}

	provideDocumentHighlights(
		document: TextDocument, position: Position, token: CancellationToken
	): Thenable<DocumentHighlight[]> {
		let file = document.fileName;
		let offset = document.offsetAt(position);

		return new Promise<DocumentHighlight[]>((resolve, reject) => {
			let disposable = this.analyzer.registerForAnalysisOccurrences(n => {
				if (n.file != file)
					return;

				disposable.dispose();

				let highlights: DocumentHighlight[] = [];

				// The analysis server returns all items in the file that can have occurances, and
				// for each item, all the occurances of it in the file. We loop through each item
				// seeing if there's a match for the current cursor position. If there is, we create
				// highlights for those occurances, short circuit the search, and return the results.
				for (let occurrence of n.occurrences) {
					this.buildOccurrences(highlights, document, offset, occurrence);
					if (highlights.length > 0) {
						resolve(highlights);
						return;
					}
				}
				resolve(highlights);
			});

			// Send a dummy edit to force an OCURRENCES notification.
			this.analyzer.sendDummyEditIfRequired(file);
		});
	}

	private buildOccurrences(
		highlights: DocumentHighlight[], document: TextDocument, position: number, occurrences: as.Occurrences
	) {
		let element = occurrences.element;
		let offsets: number[] = occurrences.offsets;
		let length: number = occurrences.length;

		for (let i = 0; i < offsets.length; i++) {
			let offset = offsets[i];

			// Look for a match in any of the occurance ranges.
			if ((offset <= position) && (position < (offset + length))) {
				// If we get a match, then create highlights for all the items in the matching occurance.
				for (let i = 0; i < offsets.length; i++) {
					let offset = offsets[i];
					let range = new Range(
						document.positionAt(offset),
						document.positionAt(offset + length)
					);
					highlights.push(new DocumentHighlight(range));
				}

				return;
			}
		}
	}

}
