import {
	TextDocument, DocumentSymbolProvider, SymbolInformation, CancellationToken, SymbolKind,
	Location, Uri, Range, Position,
} from "vscode";
import { Analyzer, getSymbolKindForElementKind } from "../analysis/analyzer";
import { toRange, fsPath } from "../utils";
import * as as from "../analysis/analysis_server_types";

export class LegacyDartDocumentSymbolProvider implements DocumentSymbolProvider {
	private analyzer: Analyzer;

	constructor(analyzer: Analyzer) {
		this.analyzer = analyzer;
	}

	public provideDocumentSymbols(document: TextDocument, token: CancellationToken): Thenable<SymbolInformation[]> {
		const file = fsPath(document.uri);

		return new Promise<SymbolInformation[]>((resolve, reject) => {
			const disposable = this.analyzer.registerForAnalysisOutline((n) => {
				if (n.file !== file)
					return;

				disposable.dispose();

				const symbols: SymbolInformation[] = [];
				for (const element of n.outline.children)
					this.transcribeOutline(document, symbols, null, element);
				resolve(symbols);
			});

			this.analyzer.forceNotificationsFor(file);
		});
	}

	private transcribeOutline(document: TextDocument, symbols: SymbolInformation[], parent: as.Element, outline: as.Outline): void {
		const element = outline.element;

		// Don't show these (#656).
		if (element.kind === "CONSTRUCTOR_INVOCATION" || element.kind === "FUNCTION_INVOCATION")
			return;

		let name = element.name;

		if (element.parameters && element.kind !== "SETTER")
			name = `${name}${element.parameters}`;

		symbols.push({
			containerName: parent && parent.name,
			kind: getSymbolKindForElementKind(element.kind),
			location: {
				range: this.getRange(document, outline),
				uri: Uri.file(element.location.file),
			},
			name,
		});

		if (outline.children) {
			for (const child of outline.children)
				this.transcribeOutline(document, symbols, element, child);
		}
	}

	private getRange(document: TextDocument, outline: as.Outline): Range {
		// The outline's location includes whitespace before the block but the elements
		// location only includes the small range declaring the element. To give the best
		// experience to the user (perfectly highlight the range) we take the start point
		// from the element but the end point from the outline.

		const startPos = document.positionAt(outline.element.location.offset);
		const endPos = document.positionAt(outline.offset + outline.length);

		return new Range(startPos, endPos);
	}
}
