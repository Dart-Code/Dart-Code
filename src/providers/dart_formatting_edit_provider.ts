"use strict";

import { DocumentFormattingEditProvider, TextDocument, FormattingOptions, CancellationToken, TextEdit, Range } from "vscode";
import { Analyzer } from "../analysis/analyzer";
import * as as from "../analysis/analysis_server_types";
import { config } from "../config";
import { logError } from "../utils";

export class DartFormattingEditProvider implements DocumentFormattingEditProvider {
	private analyzer: Analyzer;
	constructor(analyzer: Analyzer) {
		this.analyzer = analyzer;
	}

	provideDocumentFormattingEdits(document: TextDocument, options: FormattingOptions, token: CancellationToken): Thenable<TextEdit[]> {
		return new Promise<TextEdit[]>((resolve, reject) => {
			this.analyzer.editFormat({
				file: document.fileName,
				selectionOffset: 0,
				selectionLength: 0,
				lineLength: config.for(document.uri).lineLength
			}).then(resp => {
				if (resp.edits.length == 0)
					resolve(null);
				else
					resolve(resp.edits.map(e => this.convertData(document, e)));
			}, e => { logError(e); reject(); });
		});
	}

	private convertData(document: TextDocument, edit: as.SourceEdit): TextEdit {
		return new TextEdit(
			new Range(document.positionAt(edit.offset), document.positionAt(edit.offset + edit.length)),
			edit.replacement
		);
	}
}
