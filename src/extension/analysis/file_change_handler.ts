import * as vs from "vscode";
import * as as from "../../shared/analysis_server_types";
import { fsPath } from "../../shared/utils/fs";
import { config } from "../config";
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

		this.analyzer.analysisUpdateContent({ files });
	}

	public onDidChangeTextDocument(e: vs.TextDocumentChangeEvent) {
		if (!util.isAnalyzable(e.document))
			return;

		if (e.contentChanges.length === 0) // This event fires for metadata changes (dirty?) so don't need to notify AS then.
			return;

		const filePath = fsPath(e.document.uri);

		if (vs.workspace.workspaceFolders
			&& vs.workspace.workspaceFolders.length // Only prompt if we actually have workspace folders open
			&& config.warnWhenEditingFilesOutsideWorkspace
			&& !this.filesWarnedAbout.has(filePath)
			&& !util.isWithinWorkspace(filePath)) {
			const dontShowAgainAction = "Don't Warn Me";
			vs.window.showWarningMessage("You are modifying a file outside of your open folders", dontShowAgainAction).then((action) => {
				if (action === dontShowAgainAction)
					config.setWarnWhenEditingFilesOutsideWorkspace(false);
			});
			this.filesWarnedAbout.add(filePath);
		}

		const files: { [key: string]: as.ChangeContentOverlay } = {};
		files[filePath] = {
			edits: e.contentChanges
				.map((c) => this.convertChange(e.document, c))
				// We must sort them last-to-first because server will apply them
				// sequentially and VS Code doesn't guarantee them in reverse order
				// (or at least, it's not documented):
				// https://github.com/microsoft/vscode/issues/88310
				// https://github.com/microsoft/vscode/issues/88570
				.sort((c1, c2) => c2.offset - c1.offset),
			type: "change",
		};
		this.analyzer.analysisUpdateContent({ files });
	}

	public onDidCloseTextDocument(document: vs.TextDocument) {
		if (!util.isAnalyzable(document))
			return;

		const files: { [key: string]: as.RemoveContentOverlay } = {};

		files[fsPath(document.uri)] = {
			type: "remove",
		};

		this.analyzer.analysisUpdateContent({ files });
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
		this.disposables.forEach((d) => d.dispose());
	}
}
