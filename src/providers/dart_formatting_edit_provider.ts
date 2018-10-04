import * as minimatch from "minimatch";
import { CancellationToken, DocumentFormattingEditProvider, FormattingOptions, OnTypeFormattingEditProvider, Position, Range, TextDocument, TextEdit } from "vscode";
import * as as from "../analysis/analysis_server_types";
import { Analyzer } from "../analysis/analyzer";
import { config } from "../config";
import { fsPath } from "../utils";
import { logError } from "../utils/log";

export class DartFormattingEditProvider implements DocumentFormattingEditProvider, OnTypeFormattingEditProvider {
	constructor(private readonly analyzer: Analyzer) { }

	public provideDocumentFormattingEdits(document: TextDocument, options: FormattingOptions, token: CancellationToken): Thenable<TextEdit[]> {
		return this.doFormat(document, true);
	}

	public provideOnTypeFormattingEdits(document: TextDocument, position: Position, ch: string, options: FormattingOptions, token: CancellationToken): Thenable<TextEdit[]> {
		return this.doFormat(document, false);
	}

	private doFormat(document: TextDocument, doLogError = true): Thenable<TextEdit[]> {
		if (!this.shouldFormat(document))
			return;
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
			}, (e) => {
				if (doLogError)
					logError(e);
				reject();
			});
		});
	}

	private shouldFormat(document: TextDocument): boolean {
		if (!document || !document.uri || document.uri.scheme !== "file")
			return;

		const resourceConf = config.for(document.uri);
		const path = fsPath(document.uri);

		return undefined === resourceConf.doNotFormat.find((p) => minimatch(path, p, { dot: true }));
	}

	private convertData(document: TextDocument, edit: as.SourceEdit): TextEdit {
		return new TextEdit(
			new Range(document.positionAt(edit.offset), document.positionAt(edit.offset + edit.length)),
			edit.replacement,
		);
	}
}
