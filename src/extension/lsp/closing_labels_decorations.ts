import * as vs from "vscode";
import { LanguageClient } from "vscode-languageclient";
import { ClosingLabelsParams, PublishClosingLabelsNotification } from "../../shared/analysis/lsp/custom_protocol";
import { fsPath } from "../../shared/utils/fs";
import { validLastCharacters } from "../decorations/closing_labels_decorations";

export class LspClosingLabelsDecorations implements vs.Disposable {
	private subscriptions: vs.Disposable[] = [];
	private closingLabels: { [key: string]: ClosingLabelsParams } = {};
	private editors: { [key: string]: vs.TextEditor } = {};
	private updateTimeout?: NodeJS.Timer;

	private readonly decorationType = vs.window.createTextEditorDecorationType({
		after: {
			color: new vs.ThemeColor("dart.closingLabels"),
			margin: "2px",
		},
		rangeBehavior: vs.DecorationRangeBehavior.ClosedOpen,
	});

	constructor(private readonly analyzer: LanguageClient) {
		// tslint:disable-next-line: no-floating-promises
		analyzer.onReady().then(() => {
			this.analyzer.onNotification(PublishClosingLabelsNotification.type, (n) => {
				const filePath = fsPath(vs.Uri.parse(n.uri));
				this.closingLabels[filePath] = n;
				// Fire an update if it was for the active document.
				if (vs.window.activeTextEditor
					&& vs.window.activeTextEditor.document
					&& filePath === fsPath(vs.window.activeTextEditor.document.uri)) {
					// Delay this so if we're getting lots of updates we don't flicker.
					if (this.updateTimeout)
						clearTimeout(this.updateTimeout);
					this.updateTimeout = setTimeout(() => this.update(), 500);
				}
			});
		});

		this.subscriptions.push(vs.window.onDidChangeActiveTextEditor((_) => this.update()));
		this.subscriptions.push(vs.workspace.onDidCloseTextDocument((td) => {
			const filePath = fsPath(td.uri);
			delete this.closingLabels[filePath];
		}));
		if (vs.window.activeTextEditor)
			this.update();
	}

	private update() {
		const editor = vs.window.activeTextEditor;
		if (!editor || !editor.document)
			return;

		const filePath = fsPath(editor.document.uri);
		if (!this.closingLabels[filePath])
			return;

		const decorations: { [key: number]: vs.DecorationOptions & { renderOptions: { after: {} } } } = [];
		for (const r of this.closingLabels[filePath].labels) {
			const labelRange = this.analyzer.protocol2CodeConverter.asRange(r.range);

			// Ensure the label we got looks like a sensible range, otherwise the outline info
			// might be stale (eg. we sent two updates, and the outline from in between them just
			// arrived). In this case, we'll just bail and do nothing, assuming a future update will
			// have the correct info.
			const finalCharacterPosition = labelRange.end;
			if (finalCharacterPosition.character < 1)
				return;

			const finalCharacterRange = new vs.Range(finalCharacterPosition.translate({ characterDelta: -1 }), finalCharacterPosition);
			const finalCharacterText = editor.document.getText(finalCharacterRange);
			if (validLastCharacters.indexOf(finalCharacterText) === -1)
				return;

			// Get the end of the line where we'll show the labels.
			const endOfLine = editor.document.lineAt(finalCharacterPosition).range.end;

			const existingDecorationForLine = decorations[endOfLine.line];
			if (existingDecorationForLine) {
				existingDecorationForLine.renderOptions.after.contentText = " // " + r.label + " " + existingDecorationForLine.renderOptions.after.contentText;
			} else {
				const dec = {
					range: new vs.Range(labelRange.start, endOfLine),
					renderOptions: { after: { contentText: " // " + r.label } },
				};
				decorations[endOfLine.line] = dec;
			}
		}

		this.editors[filePath] = editor;
		editor.setDecorations(this.decorationType, Object.keys(decorations).map((k) => parseInt(k, 10)).map((k) => decorations[k]));
	}

	public dispose() {
		for (const editor of Object.values(this.editors)) {
			try {
				editor.setDecorations(this.decorationType, []);
			} catch {
				// It's possible the editor was closed, but there
				// doesn't seem to be a way to tell.
			}
		}
		this.subscriptions.forEach((s) => s.dispose());
	}
}
