import { WorkspaceSymbolProvider, SymbolInformation, CancellationToken, SymbolKind, Location, Uri, Range, Position, workspace, DocumentSymbolProvider, TextDocument } from "vscode";
import * as path from "path";
import * as fs from "fs";
import { Analyzer, getSymbolKindForElementKind } from "../analysis/analyzer";
import { toRange, isWithinWorkspace, logError, escapeRegExp } from "../utils";
import * as as from "../analysis/analysis_server_types";

export class DartSymbolProvider implements WorkspaceSymbolProvider, DocumentSymbolProvider {
	private analyzer: Analyzer;
	private badChars: RegExp = new RegExp("[^0-9a-z\-]", "gi");
	constructor(analyzer: Analyzer) {
		this.analyzer = analyzer;
	}

	public async provideWorkspaceSymbols(query: string, token: CancellationToken): Promise<SymbolInformation[]> {
		if (query.length === 0)
			return null;

		// Turn query into a case-insensitive fuzzy search.
		const pattern = ".*" + query.replace(this.badChars, "").split("").map((c) => `[${c.toUpperCase()}${c.toLowerCase()}]`).join(".*") + ".*";
		const results = await this.analyzer.searchGetElementDeclarations({ pattern });

		return results.declarations.map((d) => this.convertResult(d, results.files[d.fileIndex]));
	}

	public async provideDocumentSymbols(document: TextDocument, token: CancellationToken): Promise<SymbolInformation[]> {
		const results = await this.analyzer.searchGetElementDeclarations({ file: document.fileName });
		return results.declarations.map((d) => this.convertResult(d, results.files[d.fileIndex]));
	}

	private convertResult(result: as.ElementDeclaration, file: string): SymbolInformation {
		return {
			containerName: result.className,
			kind: getSymbolKindForElementKind(result.kind),
			location: {
				range: toRange({ startLine: result.line, startColumn: result.column, length: 0 }),
				uri: Uri.file(file),
			},
			name: result.name + (result.parameters || ""),
		};
	}
}
