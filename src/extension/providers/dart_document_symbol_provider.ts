import { CancellationToken, DocumentSymbol, DocumentSymbolProvider, TextDocument } from "vscode";
import { Outline } from "../../shared/analysis_server_types";
import { waitFor } from "../../shared/utils/promises";
import { Analyzer, getSymbolKindForElementKind } from "../analysis/analyzer";
import { openFileTracker } from "../analysis/open_file_tracker";
import { toRange } from "../utils";

export class DartDocumentSymbolProvider implements DocumentSymbolProvider {
	constructor(public readonly analyzer: Analyzer) { }

	public async provideDocumentSymbols(document: TextDocument, token: CancellationToken): Promise<DocumentSymbol[]> {
		const outline = await waitFor(() => openFileTracker.getOutlineFor(document.uri), 500, 60000, token);
		if (token.isCancellationRequested || !outline || !outline.children || !outline.children.length)
			return;
		return outline.children.map((r) => this.convertResult(document, r));
	}

	private convertResult(document: TextDocument, outline: Outline): DocumentSymbol {
		const symbol = new DocumentSymbol(
			outline.element.name || "<unnamed>", outline.element.parameters,
			getSymbolKindForElementKind(outline.element.kind),
			this.getCodeOffset(document, outline),
			toRange(document, outline.element.location.offset, outline.element.location.length),
		);

		if (outline.children && outline.children.length) {
			symbol.children = outline.children.filter(this.shouldShow).map((r) => this.convertResult(document, r));
		}

		return symbol;
	}

	private shouldShow(outline: Outline): boolean {
		// Don't show these (#656).
		if (outline.element.kind === "CONSTRUCTOR_INVOCATION" || outline.element.kind === "FUNCTION_INVOCATION")
			return false;
		return true;
	}

	private getCodeOffset(document: TextDocument, outline: Outline & { codeOffset?: number, codeLength?: number }) {
		return toRange(document, outline.codeOffset || outline.offset, outline.codeLength || outline.length);
	}
}
