"use strict";

import {
	TextDocument, Position, CancellationToken, CodeActionProvider, CodeActionContext,
	TextEdit, Range, Command
} from "vscode";
import { Analyzer } from "../analysis/analyzer";
import { logError, isAnalyzable } from "../utils";
import * as as from "../analysis/analysis_server_types";

export class DartCodeActionProvider implements CodeActionProvider {
	private analyzer: Analyzer;
	constructor(analyzer: Analyzer) {
		this.analyzer = analyzer;
	}

	provideCodeActions(document: TextDocument, range: Range, context: CodeActionContext, token: CancellationToken): Thenable<Command[]> {
		if (!isAnalyzable(document))
			return null;
		return new Promise<Command[]>((resolve, reject) => {
			this.analyzer.editGetFixes({
				file: document.fileName,
				offset: document.offsetAt(range.start)
			}).then(resp => {
				let allFixes = new Array<as.SourceChange>().concat(...resp.fixes.map(fix => fix.fixes));
				resolve(allFixes.map(fix => this.convertResult(document, fix)));
			}, e => { logError(e); reject(); });
		});
	}

	private convertResult(document: TextDocument, change: as.SourceChange): Command {
		return {
			title: change.message,
			command: "dart.applySourceChange",
			arguments: [document, change]
		};
	}
}
