import * as vs from "vscode";
import { LanguageClient } from "vscode-languageclient/node";
import { ClosingLabelsParams, PublishClosingLabelsNotification } from "../../shared/analysis/lsp/custom_protocol";
import { disposeAll } from "../../shared/utils";
import { uriComparisonString } from "../../shared/utils/fs";
import { config } from "../config";
import { validLastCharacters } from "../decorations/closing_labels_decorations";

export class LspClosingLabelsDecorations implements vs.Disposable {
	private subscriptions: vs.Disposable[] = [];
	private closingLabels: { [key: string]: ClosingLabelsParams } = {};
	private editors: { [key: string]: vs.TextEditor } = {};
	private updateTimeouts: { [key: string]: NodeJS.Timeout } = {};

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

	constructor(private readonly analyzer: LanguageClient) {
		this.closingLabelsPrefix = config.closingLabelsPrefix;
		this.buildDecorationType();

		void analyzer.start().then(() => {
			this.analyzer.onNotification(PublishClosingLabelsNotification.type, (n) => {
				const uri = vs.Uri.parse(n.uri);
				const uriKey = uriComparisonString(uri);
				this.closingLabels[uriKey] = n;
				// Fire an update if it was for a visible editor.
				const editor = vs.window.visibleTextEditors.find((e) => uriComparisonString(e.document.uri) === uriKey);
				if (editor) {
					// Delay this so if we're getting lots of updates we don't flicker.
					if (this.updateTimeouts[uriKey])
						clearTimeout(this.updateTimeouts[uriKey]);
					this.updateTimeouts[uriKey] = setTimeout(() => this.update(uri), 500);
				}
			});
		});

		this.subscriptions.push(vs.window.onDidChangeVisibleTextEditors(() => this.updateAll()));
		this.subscriptions.push(vs.workspace.onDidCloseTextDocument((td) => {
			const uriKey = uriComparisonString(td.uri);
			delete this.closingLabels[uriKey];
		}));
		this.subscriptions.push(vs.workspace.onDidChangeConfiguration((e) => {
			let needsUpdate = false;
			if (e.affectsConfiguration("dart.closingLabelsPrefix")) {
				needsUpdate = true;
				this.closingLabelsPrefix = config.closingLabelsPrefix;
			}
			if (e.affectsConfiguration("dart.closingLabels") || e.affectsConfiguration("dart.closingLabelsTextStyle")) {
				needsUpdate = true;
				this.decorationType.dispose();
				this.buildDecorationType();
			}
			if (needsUpdate) {
				this.updateAll();
			}
		}));

		this.updateAll();
	}

	private updateAll() {
		for (const editor of vs.window.visibleTextEditors)
			this.update(editor.document.uri);
	}

	private update(uri: vs.Uri) {
		const uriKey = uriComparisonString(uri);
		if (!this.closingLabels[uriKey])
			return;

		const editor = vs.window.visibleTextEditors.find((e) => uriComparisonString(e.document.uri) === uriKey);
		if (!editor) return;

		const decorations: { [key: number]: vs.DecorationOptions & { renderOptions: { after: { contentText: string } } } } = [];
		for (const r of this.closingLabels[uriKey].labels) {
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
			if (!validLastCharacters.includes(finalCharacterText))
				return;

			// Get the end of the line where we'll show the labels.
			const endOfLine = editor.document.lineAt(finalCharacterPosition).range.end;

			const existingDecorationForLine = decorations[endOfLine.line];
			if (existingDecorationForLine) {
				existingDecorationForLine.renderOptions.after.contentText = this.closingLabelsPrefix + r.label + " " + existingDecorationForLine.renderOptions.after.contentText;
			} else {
				const dec = {
					range: new vs.Range(labelRange.start, endOfLine),
					renderOptions: { after: { contentText: this.closingLabelsPrefix + r.label } },
				};
				decorations[endOfLine.line] = dec;
			}
		}

		this.editors[uriKey] = editor;
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
		this.decorationType.dispose();
		disposeAll(this.subscriptions);
	}
}
