"use strict";

import * as vs from "vscode";
import * as path from "path";
import { Analyzer } from "./analysis/analyzer";
import * as as from "./analysis/analysis_server_types";
import * as util from "./utils";

export class FileChangeHandler {
	private analyzer: Analyzer;
	constructor(analyzer: Analyzer) {
		this.analyzer = analyzer;
	}

	onDidOpenTextDocument(document: vs.TextDocument) {
		if (!util.isAnalyzable(document))
		  return;

		let files: { [key: string]: as.AddContentOverlay } = {};

		files[document.fileName] = {
			type: "add",
			content: document.getText()
		};

		this.analyzer.analysisUpdateContent({ files: files });
	}

	onDidChangeTextDocument(e: vs.TextDocumentChangeEvent) {
		if (!util.isAnalyzable(e.document))
		  return;

		// TODO: Fix this...
		// HACK: e.document.offsetAt appears to return the wrong offset when there are
		// multiple edits (since it uses the current document state which can include
		// earlier edits, offsetting the values!)
		//   See https://github.com/Microsoft/vscode/issues/10047
		//
		// As a workaround, we just send the full contents if there was more than one edit.

		if (e.contentChanges.length == 1) {
			let files: { [key: string]: as.ChangeContentOverlay } = {};

			files[e.document.fileName] = {
				type: "change",
				edits: e.contentChanges.map(c => this.convertChange(e.document, c))
			};

			this.analyzer.analysisUpdateContent({ files: files });
		}
		else {
			// TODO: Remove this block when the bug is fixed (or we figure out it's not a bug).
			let files: { [key: string]: as.AddContentOverlay } = {};

			files[e.document.fileName] = {
				type: "add",
				content: e.document.getText()
			};

			this.analyzer.analysisUpdateContent({ files: files });
		}
	}

	onDidCloseTextDocument(document: vs.TextDocument) {
		if (!util.isAnalyzable(document))
		  return;

		let files: { [key: string]: as.RemoveContentOverlay } = {};

		files[document.fileName] = {
			type: "remove"
		};

		this.analyzer.analysisUpdateContent({ files: files });
	}

	private convertChange(document: vs.TextDocument, change: vs.TextDocumentContentChangeEvent): as.SourceEdit {
		return {
			offset: document.offsetAt(change.range.start),
			length: change.rangeLength,
			replacement: change.text,
			id: ""
		}
	}
}
