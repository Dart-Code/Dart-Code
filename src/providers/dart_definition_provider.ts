"use strict";

import {
	DefinitionProvider, Definition, TextDocument, Location, Uri, Position, CancellationToken,
	CompletionItemProvider, CompletionList, CompletionItem, CompletionItemKind, TextEdit, Range
} from "vscode";
import { Analyzer } from "../analysis/analyzer";
import * as as from "../analysis/analysis_server_types";
import * as util from "../utils";

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
					// This filter is required because SDK 1.18.10 (and earlier) return 0s for SDK classes.
					// Although this may be fixed in future, we can't rely on the user having a newer SDK so
					// we should leave the filter in, and if their SDK supports it, it'll just start working.
					//   See: https://groups.google.com/a/dartlang.org/forum/#!topic/analyzer-discuss/VGmyyvsfdI8
					resolve(resp.targets.filter(t => t.startLine > 0).map(t => this.convertResult(t, resp.files[t.fileIndex])));
			}, e => { console.warn(e.message); reject(); });
		});
	}

	private convertResult(target: as.NavigationTarget, file: string): Location {
		return {
			uri: Uri.file(file),
			range: util.toRange(target)
		};
	}
}