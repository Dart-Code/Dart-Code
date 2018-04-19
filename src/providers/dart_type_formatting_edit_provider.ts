import { OnTypeFormattingEditProvider, TextDocument, Position, FormattingOptions, CancellationToken, TextEdit, Range } from "vscode";
import { Analyzer } from "../analysis/analyzer";
import * as as from "../analysis/analysis_server_types";
import { config } from "../config";
import { logError, fsPath } from "../utils";

export class DartTypeFormattingEditProvider implements OnTypeFormattingEditProvider {
	private analyzer: Analyzer;
	constructor(analyzer: Analyzer) {
		this.analyzer = analyzer;
	}

	public provideOnTypeFormattingEdits(document: TextDocument, position: Position, ch: string, options: FormattingOptions, token: CancellationToken): Thenable<TextEdit[]> {
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
			}, (e) => { reject(); });
		});
	}

	private convertData(document: TextDocument, edit: as.SourceEdit): TextEdit {
		return new TextEdit(
			new Range(document.positionAt(edit.offset), document.positionAt(edit.offset + edit.length)),
			edit.replacement,
		);
	}
}
