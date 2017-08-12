"use strict";

import * as vs from "vscode";
import { Analyzer } from "../analysis/analyzer";
import * as as from "../analysis/analysis_server_types";
import { isAnalyzable } from "../utils";

export class ClosingLabelsDecorations implements vs.Disposable {
	private analyzer: Analyzer;
	private subscriptions: vs.Disposable[] = [];
	private activeEditor: vs.TextEditor;

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

		this.subscriptions.push(this.analyzer.registerForAnalysisClosingLabels(n => {
			if (n.file == this.activeEditor.document.fileName) {
				this.update(n);
			}
		}));

		this.subscriptions.push(vs.window.onDidChangeActiveTextEditor(e => this.setTrackingFile(e)));
		if (vs.window.activeTextEditor)
			this.setTrackingFile(vs.window.activeTextEditor);

	}

	private update(notification: as.AnalysisClosingLabelsNotification) {
		const decorations: { [key: number]: vs.DecorationOptions } = [];
		// Becuase syntax errors result in lots of labels ending on the same character, we'll
		// track any offsets that have been used and use them to remove the labels.
		const offsetUsed: { [key: number]: boolean } = [];

		var hasBadNotifications = false;

		notification.labels.forEach((r) => {
			const finalCharacterPosition = this.activeEditor.document.positionAt(r.offset + r.length);
			const finalCharacterRange =
				finalCharacterPosition.character > 0
					? new vs.Range(finalCharacterPosition.translate({ characterDelta: -1 }), finalCharacterPosition)
					: new vs.Range(finalCharacterPosition, finalCharacterPosition.translate({ characterDelta: 1 }));
			const finalCharacterText = this.activeEditor.document.getText(finalCharacterRange);
			const endOfLine = this.activeEditor.document.lineAt(finalCharacterPosition).range.end;

			// We won't update if we had any bad notifications as this usually means either bad code resulted
			// in wonky results or the document was updated before the notification came back.
			if (finalCharacterText != ']' && finalCharacterText != ')')
				hasBadNotifications = true;

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
		// Don't update if we had any bad notifications as this usually means either bad code resulted
		// in wonky results, or it's because of the document updating before the notification came back.
		if (!hasBadNotifications)
			this.activeEditor.setDecorations(this.decorationType, Object.keys(decorations).map(k => parseInt(k)).map(k => decorations[k]));
	}

	private setTrackingFile(editor: vs.TextEditor) {
		if (isAnalyzable(editor.document)) {
			this.activeEditor = editor;

			// Send a dummy edit to force an CLOSING_LABELS notifications.
			this.analyzer.forceNotificationsFor(editor.document.fileName);
		}
	}

	dispose() {
		this.subscriptions.forEach(s => s.dispose());
	}
}
