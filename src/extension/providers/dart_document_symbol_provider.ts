import { CancellationToken, DocumentSymbol, DocumentSymbolProvider, SymbolKind, TextDocument } from "vscode";
import { waitFor } from "../../shared/utils/promises";
import { FlutterOutline, Outline } from "../analysis/analysis_server_types";
import { Analyzer, getSymbolKindForElementKind } from "../analysis/analyzer";
import { openFileTracker } from "../analysis/open_file_tracker";
import { config } from "../config";
import { toRange } from "../utils";

export class DartDocumentSymbolProvider implements DocumentSymbolProvider {
	constructor(public readonly analyzer: Analyzer) { }

	public async provideDocumentSymbols(document: TextDocument, token: CancellationToken): Promise<DocumentSymbol[]> {
		const useFlutterOutline = config.showFlutterWidgetCreationInOutlineView && this.analyzer.capabilities.supportsFlutterOutline;

		if (useFlutterOutline) {
			const outline = await waitFor(() => openFileTracker.getFlutterOutlineFor(document.uri), 500, 60000, token);
			if (token.isCancellationRequested || !outline || !outline.children || !outline.children.length)
				return;
			return outline.children.map((r) => this.convertFlutterResult(document, r));
		} else {
			const outline = await waitFor(() => openFileTracker.getOutlineFor(document.uri), 500, 60000, token);
			if (token.isCancellationRequested || !outline || !outline.children || !outline.children.length)
				return;
			return outline.children.map((r) => this.convertResult(document, r));
		}
	}

	private convertResult(document: TextDocument, outline: Outline): DocumentSymbol {
		const symbol = new DocumentSymbol(
			outline.element.name || "<unnamed>",
			outline.element.parameters,
			getSymbolKindForElementKind(outline.element.kind),
			this.getCodeOffset(document, outline),
			toRange(document, outline.element.location.offset, outline.element.location.length),
		);

		if (outline.children && outline.children.length) {
			symbol.children = outline.children.filter(this.shouldShow).map((r) => this.convertResult(document, r));
		}

		return symbol;
	}

	private convertFlutterResult(document: TextDocument, outline: FlutterOutline): DocumentSymbol {
		const loc: { offset: number, length: number, codeOffset?: number, codeLength?: number } = outline.dartElement ? outline.dartElement.location : outline;
		const name = outline.dartElement ? outline.dartElement.name : (outline.variableName || outline.className || outline.label);
		const details = this.getDetails(outline);
		const symbol = new DocumentSymbol(
			name,
			details,
			outline.dartElement ? getSymbolKindForElementKind(outline.dartElement.kind) : SymbolKind.Constructor,
			this.getCodeOffset(document, loc),
			toRange(document, loc.offset, loc.length),
		);

		if (outline.children && outline.children.length) {
			symbol.children = outline.children.map((r) => this.convertFlutterResult(document, r));
		}

		return symbol;
	}

	private shouldShow(outline: Outline): boolean {
		// Don't show these (#656).
		if (outline.element.kind === "CONSTRUCTOR_INVOCATION" || outline.element.kind === "FUNCTION_INVOCATION")
			return false;
		return true;
	}

	private getCodeOffset(document: TextDocument, outline: { offset: number, length: number, codeOffset?: number, codeLength?: number }) {
		return toRange(document, outline.codeOffset || outline.offset, outline.codeLength || outline.length);
	}

	private getDetails(outline: FlutterOutline): string {
		let label = "";

		if (outline.dartElement) {
			if (outline.dartElement.typeParameters)
				label += outline.dartElement.typeParameters;
			if (outline.dartElement.parameters)
				label += outline.dartElement.parameters;
			if (outline.dartElement.parameters && outline.dartElement.returnType)
				label += " → ";
			if (outline.dartElement.returnType)
				label += outline.dartElement.returnType;
		}

		return label.trim();
	}
}
