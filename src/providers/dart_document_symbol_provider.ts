import { CancellationToken, DocumentSymbol, DocumentSymbolProvider, TextDocument } from "vscode";
import * as as from "../analysis/analysis_server_types";
import { Analyzer, getSymbolKindForElementKind } from "../analysis/analyzer";
import { fsPath, toRange } from "../utils";

export class DartDocumentSymbolProvider implements DocumentSymbolProvider {
	constructor(public readonly analyzer: Analyzer) { }

	public async provideDocumentSymbols(document: TextDocument, token: CancellationToken): Promise<DocumentSymbol[]> {
		const results = await this.analyzer.searchGetElementDeclarations({ file: fsPath(document.uri) });
		const symbols = results.declarations.map((d) => this.convertDocumentResult(document, d, results.files[d.fileIndex]));
		// We have a flat list, but need to populate the `children` properties, so look for overlaps in range.
		const topLevels: DocumentSymbol[] = [];
		for (const symbol of symbols) {
			// Find if we are entirely contained by other symbols.
			const ancestors = symbols.filter((a) => a !== symbol
				&& a.range.start.isBeforeOrEqual(symbol.range.start)
				&& a.range.end.isAfterOrEqual(symbol.range.end));
			if (ancestors.length) {
				// Add the symbol to the child collection of its closest ancestor.
				const closestAncestor = ancestors.sort((a1, a2) => a1.range.start.compareTo(a2.range.start))[0];
				closestAncestor.children = closestAncestor.children || [];
				closestAncestor.children.push(symbol);
			} else {
				topLevels.push(symbol);
			}
		}
		return topLevels;
	}

	private convertDocumentResult(document: TextDocument | undefined, result: as.ElementDeclaration, file: string): DocumentSymbol {
		const names = this.getNames(result, false, file);

		return new DocumentSymbol(
			names.name,
			undefined,
			getSymbolKindForElementKind(result.kind),
			toRange(document, result.codeOffset, result.codeLength),
			toRange(document, result.offset, result.name.length),
		);
	}

	private getNames(result: as.ElementDeclaration, includeFilename: boolean, file: string) {
		let name = result.name;
		// Constructors don't come prefixed with class name, so add them for a nice display:
		//    () => MyClass()
		//    named() => MyClass.named()
		let nameIsPrefixedWithClass = false;
		if (result.kind === "CONSTRUCTOR" && result.className) {
			if (name) {
				nameIsPrefixedWithClass = true;
				name = `${result.className}.${name}`;
			} else {
				name = result.className;
			}
		}
		if (result.parameters && result.kind !== "SETTER")
			name += result.parameters;

		return { name, className: result.className };
	}
}
