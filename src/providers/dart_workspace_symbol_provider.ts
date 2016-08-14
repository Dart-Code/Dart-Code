"use strict";

import { WorkspaceSymbolProvider, SymbolInformation, CancellationToken, SymbolKind, Location, Uri, Range, Position } from "vscode";
import { Analyzer, getSymbolKindForElementKind } from "../analysis/analyzer";
import { toRange, isWithinRootPath } from "../utils";
import * as as from "../analysis/analysis_server_types";

export class DartWorkspaceSymbolProvider implements WorkspaceSymbolProvider {
	private analyzer: Analyzer;
	constructor(analyzer: Analyzer) {
		this.analyzer = analyzer;
	}

	provideWorkspaceSymbols(query: string, token: CancellationToken): Thenable<SymbolInformation[]> {
		query = this.sanitizeUserQuery(query);
		return new Promise<SymbolInformation[]>((resolve, reject) => {
			Promise.all([
				this.searchTopLevelSymbols(query),
				this.searchmemberDeclerations(query)
			]).then(results => resolve(this.combineResults(results)), e => { console.warn(e.message); reject(); });
		});
	}

	private combineResults(results: as.SearchResult[][]): SymbolInformation[] {
		return results[0].concat(results[1]).filter(r => this.shouldIncludeResult(r)).map(r => this.convertResult(r));
	}

	private searchTopLevelSymbols(query: string): PromiseLike<as.SearchResult[]> {
		let chars = Array.from(query);
		chars = chars.map((c: string) => {
			if (c.toUpperCase() == c.toLowerCase())
				return c;
			return `[${c.toUpperCase()}${c.toLowerCase()}]`;
		});
		let pattern = chars.join(".*");

		return new Promise<as.SearchResult[]>((resolve, reject) => {
			this.analyzer.searchFindTopLevelDeclarations({ pattern: pattern }).then(resp => {
				let disposable = this.analyzer.registerForSearchResults(notification => {
					// Skip any results that are not ours (or are not the final results).
					if (notification.id != resp.id || !notification.isLast)
						return;

					disposable.dispose();
					resolve(notification.results);
				})
			}, e => { console.warn(e.message); reject(); });
		});
	}

	private searchmemberDeclerations(query: string): PromiseLike<as.SearchResult[]> {
		return new Promise<as.SearchResult[]>((resolve, reject) => {
			this.analyzer.searchFindMemberDeclarations({
				name: query
			}).then(resp => {
				let disposable = this.analyzer.registerForSearchResults(notification => {
					// Skip any results that are not ours (or are not the final results).
					if (notification.id != resp.id || !notification.isLast)
						return;

					disposable.dispose();
					resolve(notification.results);
				})
			}, e => { console.warn(e.message); reject(); });
		});
	}

	private sanitizeUserQuery(query: string): string {
		let chars = Array.from(query);
		// Filter out special chars that will break regex.
		// searchFindTopLevelDeclarations supports regex, but we build the pattern with the output of this.
		// searchmemberDeclerations is not intended to support regex but does.
		chars = chars.filter((c) => {
			return "[](){}\\|./<>?+".indexOf(c) == -1;
		});
		return chars.join("");
	}

	private shouldIncludeResult(result: as.SearchResult): boolean {
		// Must be either:
		//   1. Public (not start with an underscore).
		//   2. In our project.
		return !result.path[0].name.startsWith("_") || isWithinRootPath(result.location.file);
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
