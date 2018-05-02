import * as vs from "vscode";
import * as as from "../analysis/analysis_server_types";
import { Analyzer } from "../analysis/analyzer";
import { fsPath, isAnalyzable } from "../utils";

export class ClosingLabelsDecorations implements vs.Disposable {
	private analyzer: Analyzer;
	private subscriptions: vs.Disposable[] = [];
	private activeEditor: vs.TextEditor;
	private closingLabels: as.AnalysisClosingLabelsNotification;
	private updateTimeout: NodeJS.Timer;

	private readonly decorationType = vs.window.createTextEditorDecorationType({
		after: {
			color: new vs.ThemeColor("dart.closingLabels"),
			margin: "2px",
		},
		rangeBehavior: vs.DecorationRangeBehavior.ClosedOpen,
	});

	constructor(analyzer: Analyzer) {
		this.analyzer = analyzer;

		this.subscriptions.push(this.analyzer.registerForAnalysisClosingLabels((n) => {
			if (this.activeEditor && n.file === fsPath(this.activeEditor.document.uri)) {
				this.closingLabels = n;
				// Delay this so if we're getting lots of updates we don't flicker.
				clearTimeout(this.updateTimeout);
				this.updateTimeout = setTimeout(() => this.update(), 500);
			}
		}));

		this.subscriptions.push(vs.window.onDidChangeActiveTextEditor((e) => this.setTrackingFile(e)));
		if (vs.window.activeTextEditor)
			this.setTrackingFile(vs.window.activeTextEditor);

	}

	private update() {
		if (!this.closingLabels || !this.activeEditor || this.closingLabels.file !== fsPath(this.activeEditor.document.uri))
			return;

		const decorations: { [key: number]: vs.DecorationOptions } = [];

		this.closingLabels.labels.forEach((r) => {
			const finalCharacterPosition = this.activeEditor.document.positionAt(r.offset + r.length);
			const finalCharacterRange =
				finalCharacterPosition.character > 0
					? new vs.Range(finalCharacterPosition.translate({ characterDelta: -1 }), finalCharacterPosition)
					: new vs.Range(finalCharacterPosition, finalCharacterPosition.translate({ characterDelta: 1 }));
			const finalCharacterText = this.activeEditor.document.getText(finalCharacterRange);
			const endOfLine = this.activeEditor.document.lineAt(finalCharacterPosition).range.end;

			// We won't update if we had any bad notifications as this usually means either bad code resulted
			// in wonky results or the document was updated before the notification came back.
			if (finalCharacterText !== "]" && finalCharacterText !== ")")
				return;

			const existingDecorationForLine = decorations[endOfLine.line];
			if (existingDecorationForLine) {
				existingDecorationForLine.renderOptions.after.contentText = " // " + r.label + " " + existingDecorationForLine.renderOptions.after.contentText;
			} else {
				const dec = {
					range: new vs.Range(this.activeEditor.document.positionAt(r.offset), endOfLine),
					renderOptions: { after: { contentText: " // " + r.label } },
				};
				decorations[endOfLine.line] = dec;
			}
		});

		this.activeEditor.setDecorations(this.decorationType, Object.keys(decorations).map((k) => parseInt(k, 10)).map((k) => decorations[k]));
	}

	private setTrackingFile(editor: vs.TextEditor) {
		if (editor && isAnalyzable(editor.document)) {
			this.activeEditor = editor;
			this.closingLabels = null;

			this.analyzer.forceNotificationsFor(fsPath(editor.document.uri));
		} else
			this.activeEditor = null;
	}

	public dispose() {
		this.activeEditor = null;
		this.subscriptions.forEach((s) => s.dispose());
	}
}
