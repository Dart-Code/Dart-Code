import * as vs from "vscode";
import * as as from "../../shared/analysis_server_types";
import { disposeAll } from "../../shared/utils";
import { fsPath } from "../../shared/utils/fs";
import * as util from "../utils";
import { DasAnalyzerClient } from "./analyzer_das";

export class FileChangeHandler implements vs.Disposable {
	private readonly disposables: vs.Disposable[] = [];
	private readonly filesWarnedAbout = new Set<string>();
	constructor(private readonly analyzer: DasAnalyzerClient) {
		this.disposables.push(
			vs.workspace.onDidOpenTextDocument((td) => this.onDidOpenTextDocument(td)),
			vs.workspace.onDidChangeTextDocument((e) => this.onDidChangeTextDocument(e)),
			vs.workspace.onDidCloseTextDocument((td) => this.onDidCloseTextDocument(td)),
		);
		// Handle already-open files.
		vs.workspace.textDocuments.forEach((td) => this.onDidOpenTextDocument(td));
	}

	public onDidOpenTextDocument(document: vs.TextDocument) {
		if (!util.isAnalyzable(document))
			return;

		const files: { [key: string]: as.AddContentOverlay } = {};

		files[fsPath(document.uri)] = {
			content: document.getText(),
			type: "add",
		};

		void this.analyzer.analysisUpdateContent({ files });
	}

	public onDidChangeTextDocument(e: vs.TextDocumentChangeEvent) {
		if (!util.isAnalyzable(e.document))
			return;

		if (e.contentChanges.length === 0) // This event fires for metadata changes (dirty?) so don't need to notify AS then.
			return;

		const files: { [key: string]: as.ChangeContentOverlay } = {};

		files[fsPath(e.document.uri)] = {
			edits: e.contentChanges.map((c) => this.convertChange(e.document, c)),
			type: "change",
		};

		void this.analyzer.analysisUpdateContent({ files });
	}

	public onDidCloseTextDocument(document: vs.TextDocument) {
		if (!util.isAnalyzable(document))
			return;

		const files: { [key: string]: as.RemoveContentOverlay } = {};

		files[fsPath(document.uri)] = {
			type: "remove",
		};

		void this.analyzer.analysisUpdateContent({ files });
	}

	private convertChange(document: vs.TextDocument, change: vs.TextDocumentContentChangeEvent): as.SourceEdit {
		return {
			id: "",
			length: change.rangeLength,
			offset: change.rangeOffset,
			replacement: change.text,
		};
	}

	public dispose(): any {
		disposeAll(this.disposables);
	}
}
