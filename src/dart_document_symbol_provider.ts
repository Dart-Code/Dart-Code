"use strict";

import { TextDocument, DocumentSymbolProvider, SymbolInformation, CancellationToken, SymbolKind, Location, Uri, Range, Position } from "vscode";
import { Analyzer, getSymbolKindForElementKind } from "./analyzer";
import { toRange } from "./utils";
import * as as from "./analysis_server_types";

export class DartDocumentSymbolProvider implements DocumentSymbolProvider {
	private analyzer: Analyzer;

	constructor(analyzer: Analyzer) {
		this.analyzer = analyzer;
	}

	provideDocumentSymbols(document: TextDocument, token: CancellationToken): Thenable<SymbolInformation[]> {
		let file = document.fileName;

		this.analyzer.analysisSetSubscriptions({
			subscriptions: { 'OUTLINE': [file] }
		});

		return new Promise<SymbolInformation[]>((resolve, reject) => {
			let disposable = this.analyzer.registerForAnalysisOutline(n => {
				if (n.file != file)
					return;

				this.analyzer.analysisSetSubscriptions({
					subscriptions: { 'OUTLINE': [] }
				});
				disposable.dispose();

				let symbols: SymbolInformation[] = [];
				for (let element of n.outline.children)
					this.transcribeOutline(symbols, null, element);
				resolve(symbols);
			});
		});
	}

	private transcribeOutline(symbols: SymbolInformation[], parent: as.Element, outline: as.Outline) {
		let element = outline.element;

		let name = element.name;
		if (element.parameters)
			name = `${name}()`;

		symbols.push({
			name: name,
			kind: getSymbolKindForElementKind(element.kind),
			location: {
				uri: Uri.file(element.location.file),
				range: toRange(element.location)
			},
			containerName: parent == null ? null : parent.name
		});

		if (outline.children) {
			for (let child of outline.children)
				this.transcribeOutline(symbols, element, child);
		}
	}
}
