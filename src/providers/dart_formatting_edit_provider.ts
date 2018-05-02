import { CancellationToken, DocumentFormattingEditProvider, FormattingOptions, Range, TextDocument, TextEdit } from "vscode";
import * as as from "../analysis/analysis_server_types";
import { Analyzer } from "../analysis/analyzer";
import { config } from "../config";
import { fsPath, logError } from "../utils";

export class DartFormattingEditProvider implements DocumentFormattingEditProvider {
	private analyzer: Analyzer;
	constructor(analyzer: Analyzer) {
		this.analyzer = analyzer;
	}

	public provideDocumentFormattingEdits(document: TextDocument, options: FormattingOptions, token: CancellationToken): Thenable<TextEdit[]> {
		return new Promise<TextEdit[]>((resolve, reject) => {
			this.analyzer.editFormat({
				file: fsPath(document.uri),
				lineLength: config.for(document.uri).lineLength,
				selectionLength: 0,
				selectionOffset: 0,
			}).then((resp) => {
				if (resp.edits.length === 0)
					resolve(null);
				else
					resolve(resp.edits.map((e) => this.convertData(document, e)));
			}, (e) => { logError(e); reject(); });
		});
	}

	private convertData(document: TextDocument, edit: as.SourceEdit): TextEdit {
		return new TextEdit(
			new Range(document.positionAt(edit.offset), document.positionAt(edit.offset + edit.length)),
			edit.replacement,
		);
	}
}
