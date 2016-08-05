"use strict";

import { DocumentFormattingEditProvider, TextDocument, FormattingOptions, CancellationToken, TextEdit, Range } from "vscode";
import { Analyzer } from "./analyzer";
import * as as from "./analysis_server_types";

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
				lineLength: 80 // TODO: Not need this
			}).then(resp => {
				if (resp.edits.length == 0)
					resolve(null);
				else
					// TODO: Add Range (probably will reduce calls to the API as mouse moves?)
					resolve(resp.edits.map(e => this.convertData(document, e)));
			});
		});
	}

	private convertData(document: TextDocument, edit: as.SourceEdit): TextEdit {
		return {
			range: new Range(document.positionAt(edit.offset), document.positionAt(edit.offset + edit.length)),
			newText: edit.replacement
		};
	}
}
