"use strict";

import { WorkspaceSymbolProvider, SymbolInformation, CancellationToken, SymbolKind, Location, Uri, Range, Position } from "vscode";
import { Analyzer, getSymbolKindForElementKind } from "./analysis/analyzer";
import { toRange } from "./utils";
import * as as from "./analysis/analysis_server_types";

export class DartWorkspaceSymbolProvider implements WorkspaceSymbolProvider {
	private analyzer: Analyzer;
	constructor(analyzer: Analyzer) {
		this.analyzer = analyzer;
	}

	provideWorkspaceSymbols(query: string, token: CancellationToken): Thenable<SymbolInformation[]> {
		let chars = Array.from(query);
		// Filter out regex special chars.
		chars = chars.filter((c) => {
			return "[]()\\-".indexOf(c) == -1;
    	});
		chars = chars.map((c: string) => {
			if (c.toUpperCase() == c.toLowerCase())
				return c;
			return `[${c.toUpperCase()}${c.toLowerCase()}]`;
		});
		let pattern = chars.join(".*");

		return new Promise<SymbolInformation[]>((resolve, reject) => {
			this.analyzer.searchFindTopLevelDeclarations({ pattern: pattern }).then(resp => {
				var disposable = this.analyzer.registerForSearchResults(notification => {
					// Skip any results that are not ours (or are not the final results).
					if (notification.id != resp.id || !notification.isLast)
						return;

					disposable.dispose();
					resolve(notification.results.map(r => this.convertResult(r)));
				})
			});
		});
	}

	private convertResult(result: as.SearchResult): SymbolInformation {
		return {
			name: result.path[0].name,
			kind: getSymbolKindForElementKind(result.path[0].kind),
			location: {
				uri: Uri.file(result.location.file),
				range: toRange(result.location)
			},
			containerName: result.path.length > 1 ? result.path[1].name : null
		};
	}
}
