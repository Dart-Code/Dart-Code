"use strict";

import { DefinitionProvider, Definition, TextDocument, Location, Uri, Position, CancellationToken, CompletionItemProvider, CompletionList, CompletionItem, CompletionItemKind, TextEdit, Range } from "vscode";
import { Analyzer } from "./analysis/analyzer";
import * as as from "./analysis/analysis_server_types";
import * as util from "./utils";

export class DartDefinitionProvider implements DefinitionProvider {
	private analyzer: Analyzer;
	constructor(analyzer: Analyzer) {
		this.analyzer = analyzer;
	}

	provideDefinition(document: TextDocument, position: Position, token: CancellationToken): Thenable<Definition> {
		return new Promise<Definition>((resolve, reject) => {
			this.analyzer.analysisGetNavigation({
				file: document.fileName,
				offset: document.offsetAt(position),
				length: 0
			}).then(resp => {
				if (resp.targets.length == 0)
					resolve(null)
				else
					// TODO: Remove this filter when we know if we can support SDK files
					//   See: https://groups.google.com/a/dartlang.org/forum/#!topic/analyzer-discuss/VGmyyvsfdI8
					resolve(resp.targets.filter(t => t.startLine > 0).map(t => this.convertResult(t, resp.files[t.fileIndex])));
			});
		});
	}

	private convertResult(target: as.NavigationTarget, file: string): Location {
		return {
			uri: Uri.file(file),
			range: util.toRange(target)
		};
	}
}