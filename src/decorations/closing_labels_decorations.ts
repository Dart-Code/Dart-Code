"use strict";

import * as vs from "vscode";
import { Analyzer } from "../analysis/analyzer";
import * as as from "../analysis/analysis_server_types";
import { isAnalyzable } from "../utils";

export class ClosingLabelsDecorations implements vs.Disposable {
	private analyzer: Analyzer;
	private subscriptions: vs.Disposable[] = [];
	private trackingFile: string;
	private activeEditor: vs.TextEditor;
	private closingLabels: as.ClosingLabel[];
	private updateTimeout: NodeJS.Timer;

	private readonly decorationType = vs.window.createTextEditorDecorationType({
		after: {
			margin: "2px",
			// TODO: Pick a good base, but have a new colour for theming?
			color: new vs.ThemeColor("tab.inactiveForeground"),
		},
		rangeBehavior: vs.DecorationRangeBehavior.ClosedClosed
	});

	constructor(analyzer: Analyzer) {
		this.analyzer = analyzer;

		this.subscriptions.push(vs.window.onDidChangeActiveTextEditor(e => this.setTrackingFile(e)));
		if (vs.window.activeTextEditor)
			this.setTrackingFile(vs.window.activeTextEditor);

		this.subscriptions.push(this.analyzer.registerForAnalysisClosingLabels(n => {
			if (n.file == this.activeEditor.document.fileName) {
				this.closingLabels = n.labels;
				// Delay this so if we're getting lots of updates we don't flicker.
				clearTimeout(this.updateTimeout);
				this.updateTimeout = setTimeout(() => this.update(), 500);
			}
		}));
	}

	private update() {
		const decorations: { [key: number]: vs.DecorationOptions } = [];
		// Becuase syntax errors result in lots of labels ending on the same character, we'll
		// track any offsets that have been used and use them to remove the labels.
		const offsetUsed: { [key: number]: boolean } = [];

		this.closingLabels.forEach((r) => {
			const endOfLine = this.activeEditor.document.lineAt(this.activeEditor.document.positionAt(r.offset + r.length)).range.end;

			// If this offset already had a label, this is likely an error and we should discount both.
			if (offsetUsed[r.offset + r.length]) {
				delete decorations[endOfLine.line];
				return;
			}
			else
				offsetUsed[r.offset + r.length] = true;

			const existingDecorationForLine = decorations[endOfLine.line];
			if (existingDecorationForLine) {
				existingDecorationForLine.renderOptions.after.contentText = " // " + r.label + " " + existingDecorationForLine.renderOptions.after.contentText;
			} else {
				const dec = {
					range: new vs.Range(this.activeEditor.document.positionAt(r.offset), endOfLine),
					renderOptions: { after: { contentText: " // " + r.label } }
				};
				decorations[endOfLine.line] = dec;
			}
		});

		this.activeEditor.setDecorations(this.decorationType, Object.keys(decorations).map(k => parseInt(k)).map(k => decorations[k]));
	}

	private setTrackingFile(editor: vs.TextEditor) {
		if (isAnalyzable(editor.document)) {
			this.activeEditor = editor;
			this.closingLabels = null;

			this.analyzer.analysisSetSubscriptions({
				subscriptions: {
					"CLOSING_LABELS": [editor.document.fileName]
				}
			});
		}
	}

	dispose() {
		this.subscriptions.forEach(s => s.dispose());
	}
}
