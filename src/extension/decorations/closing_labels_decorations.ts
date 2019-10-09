import * as vs from "vscode";
import * as as from "../../shared/analysis_server_types";
import { fsPath } from "../../shared/vscode/utils";
import { Analyzer } from "../analysis/analyzer";
import { isAnalyzable } from "../utils";

export class ClosingLabelsDecorations implements vs.Disposable {
	private readonly validLastCharacters = [")", "]"];
	private subscriptions: vs.Disposable[] = [];
	private activeEditor?: vs.TextEditor;
	private closingLabels?: as.AnalysisClosingLabelsNotification;

	private readonly decorationType = vs.window.createTextEditorDecorationType({
		after: {
			color: new vs.ThemeColor("dart.closingLabels"),
			margin: "2px",
		},
		rangeBehavior: vs.DecorationRangeBehavior.ClosedOpen,
	});

	constructor(private readonly analyzer: Analyzer) {
		this.subscriptions.push(this.analyzer.registerForAnalysisClosingLabels((n) => {
			if (this.activeEditor && n.file === fsPath(this.activeEditor.document.uri)) {
				this.closingLabels = n;
				this.update();
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

		for (const r of this.closingLabels.labels) {
			// Ensure the label we got looks like a sensible range, otherwise the outline info
			// might be stale (eg. we sent two updates, and the outline from in between them just
			// arrived). In this case, we'll just bail and do nothing, assuming a future update will
			// have the correct info.
			const endPos = this.activeEditor.document.positionAt(r.offset + r.length);
			const lastChar = this.activeEditor.document.getText(new vs.Range(endPos.translate({ characterDelta: -1 }), endPos));
			if (this.validLastCharacters.indexOf(lastChar) === -1)
				return;

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
		}

		this.activeEditor.setDecorations(this.decorationType, Object.keys(decorations).map((k) => parseInt(k, 10)).map((k) => decorations[k]));
	}

	private setTrackingFile(editor: vs.TextEditor | undefined) {
		if (editor && isAnalyzable(editor.document)) {
			this.activeEditor = editor;
			this.closingLabels = undefined;

			this.analyzer.forceNotificationsFor(fsPath(editor.document.uri));
		} else
			this.activeEditor = undefined;
	}

	public dispose() {
		this.activeEditor = undefined;
		this.subscriptions.forEach((s) => s.dispose());
	}
}
