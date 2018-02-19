"use strict";

import {
	ReferenceProvider, ReferenceContext, TextDocument, Location, Uri, Position, CancellationToken,
	CompletionItemProvider, CompletionList, CompletionItem, CompletionItemKind, TextEdit, Range,
} from "vscode";
import { Analyzer } from "../analysis/analyzer";
import * as as from "../analysis/analysis_server_types";
import * as util from "../utils";

export class DartReferenceProvider implements ReferenceProvider {
	private analyzer: Analyzer;
	constructor(analyzer: Analyzer) {
		this.analyzer = analyzer;
	}

	public provideReferences(document: TextDocument, position: Position, context: ReferenceContext, token: CancellationToken): Thenable<Location[]> {
		return new Promise<Location[]>((resolve, reject) => {
			this.analyzer.searchFindElementReferencesResults({
				file: document.fileName,
				includePotential: true,
				offset: document.offsetAt(position),
			}).then(
				(resp) => resolve(resp.results.map((r) => this.convertResult(r))),
				() => reject(),
			);
		});
	}

	private convertResult(result: as.SearchResult): Location {
		return {
			range: util.toRange(result.location),
			uri: Uri.file(result.location.file),
		};
	}
}
