import * as path from "path";
import * as vs from "vscode";
import { uniq } from "../../shared/utils";
import { fsPath } from "../../shared/vscode/utils";
import { DebugCommands } from "../commands/debug";
import { CoverageData } from "../debug/utils";
import { extensionPath } from "../utils";
import { logError } from "../utils/log";

export class HotReloadCoverageDecorations implements vs.Disposable {
	private subscriptions: vs.Disposable[] = [];
	private fileState: {
		[key: string]: {
			modified: number[],
			notRun: number[],
		},
	} = {};
	private isDebugging = false;

	private readonly modifiedDecorationType = vs.window.createTextEditorDecorationType({
		gutterIconPath: vs.Uri.file(path.join(extensionPath, `media/icons/reload_coverage/modified.svg`)),
		isWholeLine: true,
		rangeBehavior: vs.DecorationRangeBehavior.OpenOpen,
	});
	private readonly notRunDecorationType = vs.window.createTextEditorDecorationType({
		gutterIconPath: vs.Uri.file(path.join(extensionPath, `media/icons/reload_coverage/not_run.svg`)),
		isWholeLine: true,
		rangeBehavior: vs.DecorationRangeBehavior.OpenOpen,
	});

	constructor(debug: DebugCommands) {
		this.subscriptions.push(vs.workspace.onDidChangeTextDocument((e) => this.onDidChangeTextDocument(e)));
		this.subscriptions.push(debug.onFirstFrame(() => this.onFirstFrame()));
		this.subscriptions.push(vs.window.onDidChangeVisibleTextEditors((e) => this.onDidChangeVisibleTextEditors(e)));
		this.subscriptions.push(debug.onWillHotReload(() => this.onWillHotReload()));
		this.subscriptions.push(debug.onWillHotRestart(() => this.onWillFullRestart()));
		this.subscriptions.push(vs.debug.onDidStartDebugSession((e) => this.onDidStartDebugSession()));
		this.subscriptions.push(vs.debug.onDidTerminateDebugSession((e) => this.onDidTerminateDebugSession()));
		this.subscriptions.push(debug.onReceiveCoverage((c) => this.onReceiveCoverage(c)));
		// TODO: On execution, remove from notRun list
		// TODO: If file modified externally, we may need to drop all markers?
	}

	private async onFirstFrame(): Promise<void> {
		await this.coverageFilesUpdate();
	}

	private async onDidChangeVisibleTextEditors(editors: vs.TextEditor[]): Promise<void> {
		this.redrawDecorations(editors);
		await this.coverageFilesUpdate();
		await this.requestCoverageUpdate();
	}

	private onDidChangeTextDocument(e: vs.TextDocumentChangeEvent) {
		if (!this.isDebugging)
			return;

		const editor = vs.window.visibleTextEditors.find((editor) => fsPath(editor.document.uri) === fsPath(e.document.uri));
		if (!editor)
			return;

		let fileState = this.fileState[fsPath(e.document.uri)];
		if (!fileState) {
			fileState = this.fileState[fsPath(e.document.uri)] = { modified: [], notRun: [] };
		}

		// Move all "not run" edits back into "edited" because we can't track them anymore as the coverage
		// data will be bad.
		fileState.modified = fileState.modified.concat(fileState.notRun);
		fileState.notRun = [];

		// Update all existing ranges offsets.
		for (const change of e.contentChanges) {
			const startLine = change.range.start.line;
			const endLine = change.range.end.line;
			const linesInRange = endLine - startLine;
			const linesInserted = change.text.split("\n").length - 1;
			const diff = linesInserted - linesInRange;
			if (diff === 0)
				continue;

			fileState.modified = this.translateChanges(fileState.modified, startLine, endLine, diff);
		}

		// Append the new ranges.
		for (const change of e.contentChanges) {
			const originalText = editor.document.getText(change.range);
			const newText = change.text;

			// Don't mark if the replacement text is the same as the old text.
			if (newText === originalText)
				continue;

			// Don't mark if we're just deleting whitespace (eg. backspace on a newline).
			if (originalText.trim() === "" && !newText)
				continue;

			// If we're just adding whitespace, don't mark that.
			if (!originalText && newText.trim() === "")
				continue;

			const linesInserted = change.text.split("\n").length - 1;

			// TODO: Make it an array of bools?
			for (let l = change.range.start.line; l <= change.range.start.line + linesInserted; l++)
				fileState.modified.push(l);
		}

		// Make the lists unique
		fileState.modified = uniq(fileState.modified);

		// Remove any uninteresting lines
		fileState.modified = fileState.modified.filter((lineNumber: number) => {
			try {
				const lineText = editor.document.lineAt(lineNumber).text.trim();

				if (lineText === "" || lineText === "{" || lineText === "}" || lineText === "/" || lineText.startsWith("//") || lineText.startsWith("@"))
					return false;

				return true;
			} catch (e) {
				logError(e);
				return false;
			}
		});

		this.redrawDecorations([editor]);
	}

	private translateChanges(lines: number[], startLine: number, endLine: number, diff: number): number[] {
		return lines
			.map((l) => {
				if (startLine >= l) {
					// If the new change is after the old one, we don't need to map.
					return l;
				} else if (startLine <= l && endLine >= l) {
					// If this new change contains the whole of the old change, we don't need the old change.
					return undefined;
				} else {
					// Otherwise, just need to offset it.
					return l + diff;
				}
			})
			.filter((l) => l);
	}

	private async onWillHotReload(): Promise<void> {
		for (const file of Object.keys(this.fileState)) {
			const fileState = this.fileState[file];
			fileState.modified.forEach((r) => fileState.notRun.push(r));
			fileState.modified.length = 0;
		}

		// After the above code we may have new files to track, so re-send them here.
		await this.coverageFilesUpdate();
		this.redrawDecorations(vs.window.visibleTextEditors);
	}

	private onWillFullRestart(): void {
		this.clearAllMarkers();
	}

	private onDidStartDebugSession(): void {
		this.isDebugging = true;
	}

	private onDidTerminateDebugSession(): void {
		this.isDebugging = false;
		this.clearAllMarkers();
	}

	private clearAllMarkers(): void {
		for (const file of Object.keys(this.fileState)) {
			delete this.fileState[file];
		}

		this.redrawDecorations(vs.window.visibleTextEditors);
	}

	private redrawDecorations(editors: vs.TextEditor[]): void {
		if (!editors)
			return;
		for (const editor of editors) {
			const fileState = this.fileState[fsPath(editor.document.uri)];
			editor.setDecorations(
				this.modifiedDecorationType,
				fileState ? this.toRanges(editor, fileState.modified) : [],
			);
			editor.setDecorations(
				this.notRunDecorationType,
				fileState ? this.toRanges(editor, fileState.notRun) : [],
			);
		}
	}

	private toRanges(editor: vs.TextEditor, lines: number[]): vs.Range[] {
		return lines.map((l) => editor.document.lineAt(l).range);
	}

	private async coverageFilesUpdate(): Promise<void> {
		if (!this.isDebugging)
			return;

		const openFilesWithChanges = vs.window
			.visibleTextEditors
			.map((e) => fsPath(e.document.uri))
			.filter((file) => this.fileState[file] && this.fileState[file].notRun.length !== 0);

		await vs.commands.executeCommand(
			"_dart.coverageFilesUpdate",
			openFilesWithChanges,
		);
	}

	private async requestCoverageUpdate(): Promise<void> {
		if (!this.isDebugging)
			return;

		// If we don't have any "not run" changes, there's no point asking for coverage.
		const hasAnyChanges = !!Object.keys(this.fileState)
			.find((file) => this.fileState[file].notRun.length !== 0);

		if (hasAnyChanges)
			await vs.commands.executeCommand("_dart.requestCoverageUpdate");
	}

	private onReceiveCoverage(coverageData: CoverageData[]): void {
		for (const data of coverageData) {
			const fileState = this.fileState[fsPath(data.scriptPath)];
			if (!fileState)
				continue;

			const editor = vs.window.visibleTextEditors.find((editor) => fsPath(editor.document.uri) === data.scriptPath);

			for (const line of data.hitLines) {
				fileState.notRun = fileState.notRun.filter((l) => l !== line - 1);
			}

			this.redrawDecorations([editor]);
		}
	}

	public dispose() {
		this.subscriptions.forEach((s) => s.dispose());
	}
}
