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

		this.analyzer.analysisSetSubscriptions({ subscriptions: { "OCCURRENCES": [file] } });

		return new Promise<DocumentHighlight[]>((resolve, reject) => {
			let disposable = this.analyzer.registerForAnalysisOccurrences(n => {
				if (n.file != file)
					return;

				this.analyzer.analysisSetSubscriptions({ subscriptions: { "OCCURRENCES": [] } });
				disposable.dispose();

				let highlights: DocumentHighlight[] = [];
				for (let occurrence of n.occurrences) {
					this.buildOccurrences(highlights, document, offset, occurrence);
					if (highlights.length > 0) {
						resolve(highlights);
						return;
					}
				}
				resolve(highlights);
			});
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

			if ((offset <= position) && (position < (offset + length))) {
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
