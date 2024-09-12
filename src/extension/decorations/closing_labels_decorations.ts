import * as vs from "vscode";
import * as as from "../../shared/analysis_server_types";
import { disposeAll } from "../../shared/utils";
import { fsPath } from "../../shared/utils/fs";
import { DasAnalyzerClient } from "../analysis/analyzer_das";
import { config } from "../config";
import { isAnalyzable } from "../utils";

export const validLastCharacters = [")", "]"];

export class ClosingLabelsDecorations implements vs.Disposable {
	private subscriptions: vs.Disposable[] = [];
	private activeEditor?: vs.TextEditor;
	private closingLabels?: as.AnalysisClosingLabelsNotification;

	private decorationType!: vs.TextEditorDecorationType;
	private closingLabelsPrefix: string;

	private buildDecorationType() {
		this.decorationType = vs.window.createTextEditorDecorationType({
			after: {
				color: new vs.ThemeColor("dart.closingLabels"),
				fontStyle: config.closingLabelsTextStyle,
				margin: "2px",
			},
			rangeBehavior: vs.DecorationRangeBehavior.ClosedOpen,
		});
	}

	constructor(private readonly analyzer: DasAnalyzerClient) {
		this.closingLabelsPrefix = config.closingLabelsPrefix;
		this.buildDecorationType();

		this.subscriptions.push(this.analyzer.registerForAnalysisClosingLabels((n) => {
			if (this.activeEditor && n.file === fsPath(this.activeEditor.document.uri)) {
				this.closingLabels = n;
				this.update();
			}
		}));

		this.subscriptions.push(vs.window.onDidChangeActiveTextEditor((e) => this.setTrackingFile(e)));
		this.subscriptions.push(vs.workspace.onDidChangeConfiguration((e) => {
			let updatedWatched = false;
			if (e.affectsConfiguration("dart.closingLabelsPrefix")) {
				updatedWatched = true;
				this.closingLabelsPrefix = config.closingLabelsPrefix;
			}
			if (e.affectsConfiguration("dart.closingLabels") || e.affectsConfiguration("dart.closingLabelsTextStyle")) {
				updatedWatched = true;
				this.decorationType.dispose();
				this.buildDecorationType();
			}
			if (updatedWatched) {
				this.update();
			}
		}));

		if (vs.window.activeTextEditor)
			this.setTrackingFile(vs.window.activeTextEditor);
	}

	private update() {
		if (!this.closingLabels || !this.activeEditor || this.closingLabels.file !== fsPath(this.activeEditor.document.uri))
			return;

		const decorations: { [key: number]: vs.DecorationOptions & { renderOptions: { after: { contentText: string } } } } = [];

		for (const r of this.closingLabels.labels) {
			// Ensure the label we got looks like a sensible range, otherwise the outline info
			// might be stale (eg. we sent two updates, and the outline from in between them just
			// arrived). In this case, we'll just bail and do nothing, assuming a future update will
			// have the correct info.
			const finalCharacterPosition = this.activeEditor.document.positionAt(r.offset + r.length);
			if (finalCharacterPosition.character < 1)
				return;

			const finalCharacterRange = new vs.Range(finalCharacterPosition.translate({ characterDelta: -1 }), finalCharacterPosition);
			const finalCharacterText = this.activeEditor.document.getText(finalCharacterRange);
			if (!validLastCharacters.includes(finalCharacterText))
				return;

			// Get the end of the line where we'll show the labels.
			const endOfLine = this.activeEditor.document.lineAt(finalCharacterPosition).range.end;

			const existingDecorationForLine = decorations[endOfLine.line];
			if (existingDecorationForLine) {
				existingDecorationForLine.renderOptions.after.contentText = this.closingLabelsPrefix + r.label + " " + existingDecorationForLine.renderOptions.after.contentText;
			} else {
				const dec = {
					range: new vs.Range(this.activeEditor.document.positionAt(r.offset), endOfLine),
					renderOptions: { after: { contentText: this.closingLabelsPrefix + r.label } },
				};
				decorations[endOfLine.line] = dec;
			}
		}

		this.activeEditor.setDecorations(this.decorationType, Object.keys(decorations).map((k) => parseInt(k, 10)).map((k) => decorations[k]));
	}

	private setTrackingFile(editor: vs.TextEditor | undefined) {
		if (!editor || !isAnalyzable(editor.document))
			return;

		if (editor !== this.activeEditor)
			this.activeEditor?.setDecorations(this.decorationType, []);

		if (editor) {
			this.activeEditor = editor;
			this.closingLabels = undefined;
			this.analyzer.forceNotificationsFor(fsPath(editor.document.uri));
		} else {
			this.activeEditor = undefined;
			this.closingLabels = undefined;
		}
	}

	public dispose() {
		this.activeEditor?.setDecorations(this.decorationType, []);
		this.activeEditor = undefined;
		this.decorationType.dispose();
		disposeAll(this.subscriptions);
	}
}
