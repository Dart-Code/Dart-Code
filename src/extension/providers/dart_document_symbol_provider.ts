import { CancellationToken, DocumentSymbol, DocumentSymbolProvider, SymbolTag, TextDocument } from "vscode";
import { Outline } from "../../shared/analysis_server_types";
import { Logger } from "../../shared/interfaces";
import { waitFor } from "../../shared/utils/promises";
import { toRange } from "../../shared/vscode/utils";
import { getSymbolKindForElementKind } from "../analysis/analyzer_das";
import { DasFileTracker } from "../analysis/file_tracker_das";

export class DartDocumentSymbolProvider implements DocumentSymbolProvider {
	constructor(private readonly logger: Logger, private readonly fileTracker: DasFileTracker) { }

	public async provideDocumentSymbols(document: TextDocument, token: CancellationToken): Promise<DocumentSymbol[] | undefined> {
		const outline = await waitFor(() => this.fileTracker.getOutlineFor(document.uri), 500, 60000, token);
		if (token.isCancellationRequested || !outline || !outline.children || !outline.children.length)
			return;
		return outline.children.map((r) => this.convertResult(document, r));
	}

	private convertResult(document: TextDocument, outline: Outline): DocumentSymbol {
		const name = outline.element.name
			? outline.element.name
			: (outline.element.kind === "EXTENSION" ? "<unnamed extension>" : "<unnamed>");
		const location = outline.element.location || outline;
		const symbol = new DocumentSymbol(
			name,
			outline.element.parameters || "",
			getSymbolKindForElementKind(this.logger, outline.element.kind),
			this.getCodeOffset(document, outline),
			toRange(document, location.offset, location.length),
		);

		// tslint:disable-next-line: no-bitwise
		if (outline.element.flags & 0x20)
			symbol.tags = [SymbolTag.Deprecated];

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
