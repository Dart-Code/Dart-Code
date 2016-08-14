"use strict";

import {
	ReferenceProvider, ReferenceContext, TextDocument, Location, Uri, Position, CancellationToken,
	CompletionItemProvider, CompletionList, CompletionItem, CompletionItemKind, TextEdit, Range
} from "vscode";
import { Analyzer } from "../analysis/analyzer";
import * as as from "../analysis/analysis_server_types";
import * as util from "../utils";

export class DartReferenceProvider implements ReferenceProvider {
	private analyzer: Analyzer;
	constructor(analyzer: Analyzer) {
		this.analyzer = analyzer;
	}

	provideReferences(document: TextDocument, position: Position, context: ReferenceContext, token: CancellationToken): Thenable<Location[]> {
		return new Promise<Location[]>((resolve, reject) => {
			this.analyzer.searchFindElementReferences({
				file: document.fileName,
				offset: document.offsetAt(position),
				includePotential: true
			}).then(resp => {
				let disposable = this.analyzer.registerForSearchResults(notification => {
					// Skip any results that are not ours (or are not the final results).
					if (notification.id != resp.id || !notification.isLast)
						return;

					disposable.dispose();
					resolve(notification.results.map(r => this.convertResult(r)));
				});
			}, e => { console.warn(e.message); reject(); });
		});
	}

	private convertResult(result: as.SearchResult): Location {
		return {
			uri: Uri.file(result.location.file),
			range: util.toRange(result.location)
		};
	}
}