import * as vs from "vscode";
import { FlutterOutline } from "../../shared/analysis/lsp/custom_protocol";
import { Logger } from "../../shared/interfaces";
import { disposeAll } from "../../shared/utils";
import { fsPath } from "../../shared/utils/fs";
import { docsIconPathFormat } from "../../shared/vscode/extension_utils";
import { IconRangeComputerLsp } from "../../shared/vscode/icon_range_computer";
import { LspAnalyzer } from "../analysis/analyzer_lsp";
import { isAnalyzable } from "../utils";

export class FlutterIconDecorations implements vs.Disposable {
	protected readonly subscriptions: vs.Disposable[] = [];
	protected activeEditor?: vs.TextEditor;
	private readonly decorationTypes: { [key: string]: vs.TextEditorDecorationType } = {};
	private readonly computer: IconRangeComputerLsp;

	constructor(logger: Logger, private readonly analyzer: LspAnalyzer) {
		this.subscriptions.push(vs.window.onDidChangeActiveTextEditor((e) => {
			this.setTrackingFile(e);
			this.update();
		}));
		setImmediate(() => {
			this.setTrackingFile(vs.window.activeTextEditor);
			this.update();
		});
		this.computer = new IconRangeComputerLsp(logger);

		this.subscriptions.push(this.analyzer.fileTracker.onFlutterOutline(async (op) => {
			if (this.activeEditor && fsPath(this.activeEditor.document.uri) === fsPath(vs.Uri.parse(op.uri))) {
				this.update(op.outline);
			}
		}));
	}

	protected update(outline?: FlutterOutline) {
		if (!this.activeEditor)
			return;

		if (!outline)
			outline = this.analyzer.fileTracker.getFlutterOutlineFor(this.activeEditor.document.uri);

		if (!outline)
			return;

		const results = this.computer.compute(outline);

		this.render(results);
	}

	protected render(results: { [key: string]: vs.Range[]; }) {
		if (!this.activeEditor)
			return;

		// Each icon type needs to be its own decoration, so here we update our main list
		// with any new ones we hadn't previously created.
		for (const iconName of Object.keys(results)) {
			if (!this.decorationTypes[iconName])
				this.decorationTypes[iconName] = vs.window.createTextEditorDecorationType({
					gutterIconPath: vs.Uri.parse(docsIconPathFormat.replace("$1", iconName)),
					gutterIconSize: "75%",
				});
		}
		for (const iconName of Object.keys(this.decorationTypes)) {
			this.activeEditor.setDecorations(this.decorationTypes[iconName], results[iconName] || []);
		}
	}

	private setTrackingFile(editor: vs.TextEditor | undefined) {
		if (editor && isAnalyzable(editor.document))
			this.activeEditor = editor;
		else
			this.activeEditor = undefined;
	}

	public dispose() {
		this.activeEditor = undefined;
		disposeAll(this.subscriptions);
	}
}
