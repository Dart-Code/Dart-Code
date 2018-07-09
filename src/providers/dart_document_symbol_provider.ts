import { CancellationToken, DocumentSymbol, DocumentSymbolProvider, TextDocument } from "vscode";
import { Outline } from "../analysis/analysis_server_types";
import { Analyzer, getSymbolKindForElementKind } from "../analysis/analyzer";
import { OpenFileTracker } from "../analysis/open_file_tracker";
import { toRange } from "../utils";
import { waitFor } from "../utils/promises";

export class DartDocumentSymbolProvider implements DocumentSymbolProvider {
	constructor(public readonly analyzer: Analyzer) { }

	public async provideDocumentSymbols(document: TextDocument, token: CancellationToken): Promise<DocumentSymbol[]> {
		const outline = await waitFor(() => {
			if (token.isCancellationRequested) {
				return;
			}
			return OpenFileTracker.getOutlineFor(document.uri);
		}, 500, 60000); // Wait up to 60 seconds for Outlines.
		if (!outline || !outline.children || !outline.children.length)
			return;
		return outline.children.map((r) => this.convertResult(document, r));
	}

	private convertResult(document: TextDocument, outline: Outline): DocumentSymbol {
		const symbol = new DocumentSymbol(
			outline.element.name, outline.element.parameters,
			getSymbolKindForElementKind(outline.element.kind),
			this.getCodeOffset(document, outline),
			toRange(document, outline.element.location.offset, outline.element.location.length),
		);

		if (outline.children && outline.children.length) {
			symbol.children = outline.children.map((r) => this.convertResult(document, r));
		}

		return symbol;
	}

	private getCodeOffset(document: TextDocument, outline: Outline & { codeOffset?: number, codeLength?: number }) {
		return toRange(document, outline.codeOffset || outline.offset, outline.codeLength || outline.length);
	}
}
