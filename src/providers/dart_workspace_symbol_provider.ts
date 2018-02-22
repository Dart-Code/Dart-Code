"use strict";

import { WorkspaceSymbolProvider, SymbolInformation, CancellationToken, SymbolKind, Location, Uri, Range, Position, workspace } from "vscode";
import * as path from "path";
import * as fs from "fs";
import { Analyzer, getSymbolKindForElementKind } from "../analysis/analyzer";
import { toRange, isWithinWorkspace, logError, escapeRegExp } from "../utils";
import * as as from "../analysis/analysis_server_types";

export class DartWorkspaceSymbolProvider implements WorkspaceSymbolProvider {
	private analyzer: Analyzer;
	private lastResults: as.SearchGetElementDeclarationsResponse;
	private resultsLastFetched: Date;
	constructor(analyzer: Analyzer) {
		this.analyzer = analyzer;
	}

	public async provideWorkspaceSymbols(query: string, token: CancellationToken): Promise<SymbolInformation[]> {
		if (query.length === 0)
			return null;

		const thirtySecondsInMS = 30000;
		const resultsCacheIsGood = this.resultsLastFetched && (new Date().getTime() - this.resultsLastFetched.getTime()) < thirtySecondsInMS;
		if (!resultsCacheIsGood) {
			this.lastResults = await this.analyzer.searchGetElementDeclarations();
			this.resultsLastFetched = new Date();
		}

		const pattern = new RegExp(escapeRegExp(query).split("").join(".*"), "gi");

		return this.lastResults.declarations.filter((d) => pattern.test(d.name)).map((d) => this.convertResult(d, this.lastResults.files[d.fileIndex]));
	}

	private convertResult(result: as.ElementDeclaration, file: string): SymbolInformation {
		return {
			containerName: result.className,
			kind: getSymbolKindForElementKind(result.kind),
			location: {
				range: toRange({ startLine: result.line, startColumn: result.column, length: 0 }),
				uri: Uri.file(file),
			},
			name: result.name,
		};
	}
}
