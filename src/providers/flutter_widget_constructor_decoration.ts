"use strict";

import * as vs from "vscode";
import { Analyzer } from "../analysis/analyzer";
import * as as from "../analysis/analysis_server_types";
import { isAnalyzable } from "../utils";

export class FlutterWidgetConstructorDecoratorProvider implements vs.Disposable {
	private analyzer: Analyzer;
	private subscriptions: vs.Disposable[] = [];
	private trackingFile: string;
	private activeEditor: vs.TextEditor;
	private outline: as.Outline;
	private highlights: as.HighlightRegion[];

	private readonly decorationType = vs.window.createTextEditorDecorationType({
		after: {
			margin: "2px",
			color: new vs.ThemeColor("tab.inactiveForeground"),
		},
		rangeBehavior: vs.DecorationRangeBehavior.ClosedClosed
	});

	constructor(analyzer: Analyzer) {
		this.analyzer = analyzer;

		this.subscriptions.push(vs.window.onDidChangeActiveTextEditor(e => this.setTrackingFile(e)));
		if (vs.window.activeTextEditor)
			this.setTrackingFile(vs.window.activeTextEditor);

		this.subscriptions.push(this.analyzer.registerForAnalysisOutline(n => {
			if (n.file == this.activeEditor.document.fileName) {
				this.outline = n.outline;
				// Delay this so if we're getting lots of updates we don't flicker.
				setTimeout(() => this.scan(), 500);
			}
		}));
		this.subscriptions.push(this.analyzer.registerForAnalysisHighlights(n => {
			if (n.file == this.activeEditor.document.fileName) {
				this.highlights = n.regions;
				// Delay this so if we're getting lots of updates we don't flicker.
				setTimeout(() => this.scan(), 500);
			}
		}));
	}

	private setTrackingFile(editor: vs.TextEditor) {
		if (isAnalyzable(editor.document)) {
			this.activeEditor = editor;
			this.outline = null;
			this.highlights = null;

			// Send a dummy edit to force an OUTLINE & HIGHLIGHTS notifications.
			this.analyzer.sendDummyEdit(editor.document.fileName);
		}
	}

	private async scan() {
		if (!this.outline || !this.highlights)
			return;

		const currentEditor = this.activeEditor; // Stash this because the active editor may change during this await.
		const results = (await Promise.all(this.searchForBuildMethod(this.activeEditor, this.outline, this.highlights))).filter(r => r != null);
		if (currentEditor != this.activeEditor)
			return;

		currentEditor.setDecorations(this.decorationType, results.map((r) => {
			return {
				range: new vs.Range(currentEditor.document.positionAt(r.offset - 1), currentEditor.document.positionAt(r.offset)),
				renderOptions: { after: { contentText: "//" + r.name } }
			}
		}));
	}

	private searchForBuildMethod(editor: vs.TextEditor, outline: as.Outline, highlights: as.HighlightRegion[]): Promise<{ name: string, offset: number }>[] {
		if (outline.element.kind == "METHOD" && outline.element.name == "build")
			return this.scanBuildMethod(editor, outline);
		else if (outline.children) {
			let results: Promise<{ name: string, offset: number }>[] = [];
			outline.children.forEach(c => results = results.concat(this.searchForBuildMethod(editor, c, highlights)));
			return results;
		}
		else
			return [];
	}

	private scanBuildMethod(editor: vs.TextEditor, outline: as.Outline): Promise<{ name: string, offset: number }>[] {
		const start = outline.offset;
		const end = outline.offset + outline.length;
		const results: Promise<{ name: string, offset: number }>[] = [];

		let prevIsNewKeyword = false;
		this.highlights.filter(h => h.offset >= start && h.offset + h.length <= end).forEach(h => {
			if (h.type == "CLASS" && prevIsNewKeyword)
				results.push(this.handleConstructor(editor, outline, h));

			// Keep track of this for next iteration.
			const tokenText = this.activeEditor.document.getText().substr(h.offset, h.length);
			prevIsNewKeyword = h.type == "KEYWORD" && (tokenText == "new" || tokenText == "const");
		});

		return results;
	}

	private async handleConstructor(editor: vs.TextEditor, outline: as.Outline, highlight: as.HighlightRegion): Promise<{ name: string, offset: number }> {
		const hover = await this.analyzer.analysisGetHover({ file: this.activeEditor.document.fileName, offset: highlight.offset });
		if (hover && hover.hovers && hover.hovers.length >= 1) {
			if (this.activeEditor.document.positionAt(hover.hovers[0].offset).line != this.activeEditor.document.positionAt(hover.hovers[0].offset + hover.hovers[0].length).line)
				return { name: hover.hovers[0].containingClassDescription, offset: hover.hovers[0].offset + hover.hovers[0].length };
		}
		return null; // Shouldn't happen!
	}

	dispose() {
		this.subscriptions.forEach(s => s.dispose());
	}
}
