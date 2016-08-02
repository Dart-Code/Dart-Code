"use strict";

import * as vscode from "vscode";
import { Analyzer } from "./analyzer";
import * as as from "./analysis_server_types";

export class FileChangeHandler {
	private analyzer: Analyzer;
	constructor(analyzer: Analyzer) {
		this.analyzer = analyzer;
	}

	onDidOpenTextDocument(document: vscode.TextDocument) {
		let files: { [key: string]: as.AddContentOverlay } = {};

		files[document.fileName] = {
			type: "add",
			content: document.getText()
		};

		this.analyzer.analysisUpdateContent({ files: files });
	}

	onDidChangeTextDocument(e: vscode.TextDocumentChangeEvent) {
		let files: { [key: string]: as.ChangeContentOverlay } = {};
		
		files[e.document.fileName] = {
			type: "change",
			edits: e.contentChanges.map(c => this.convertChange(e.document, c))
		};

		this.analyzer.analysisUpdateContent({ files: files });
	}

	onDidCloseTextDocument(document: vscode.TextDocument) {
		let files: { [key: string]: as.RemoveContentOverlay } = {};

		files[document.fileName] = {
			type: "remove"
		};

		this.analyzer.analysisUpdateContent({ files: files });
	}

	private convertChange(document: vscode.TextDocument, change: vscode.TextDocumentContentChangeEvent): as.SourceEdit {
		return {
			offset: document.offsetAt(change.range.start),
			length: change.rangeLength,
			replacement: change.text,
			id: "" // TODO: Fix this, should be optional!
		}
	}
}
