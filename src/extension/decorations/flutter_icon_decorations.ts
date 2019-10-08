import * as vs from "vscode";
import { FlutterOutline } from "../../shared/analysis_server_types";
import { Logger } from "../../shared/interfaces";
import { iconUrlFormat } from "../../shared/utils/dartdocs";
import { FlutterOutlineIconVisitor } from "../../shared/utils/flutter_outline";
import { fsPath } from "../../shared/vscode/utils";
import { Analyzer } from "../analysis/analyzer";
import { openFileTracker } from "../analysis/open_file_tracker";
import { isAnalyzable, toRange } from "../utils";

export class FlutterIconDecorations implements vs.Disposable {
	private subscriptions: vs.Disposable[] = [];
	private activeEditor?: vs.TextEditor;

	private readonly decorationTypes: { [key: string]: vs.TextEditorDecorationType } = {};

	constructor(private readonly logger: Logger, private readonly analyzer: Analyzer) {
		this.subscriptions.push(this.analyzer.registerForFlutterOutline(async (n) => {
			if (this.activeEditor && fsPath(this.activeEditor.document.uri) === n.file) {
				this.update(n.outline);
			}
		}));

		this.subscriptions.push(vs.window.onDidChangeActiveTextEditor((e) => this.setTrackingFile(e)));
		if (vs.window.activeTextEditor) {
			this.setTrackingFile(vs.window.activeTextEditor);
			this.update();
		}
	}

	private update(outline?: FlutterOutline) {
		if (!this.activeEditor)
			return;

		if (!outline)
			outline = openFileTracker.getFlutterOutlineFor(this.activeEditor.document.uri);

		if (!outline)
			return;

		const iconVisitor = new FlutterOutlineIconVisitor(this.logger);
		iconVisitor.visit(outline);

		// Each icon type needs to be its own decoration, so here we update our main list
		// with any new ones we hadn't previously created.
		iconVisitor.icons.forEach((icon) => {
			if (!this.decorationTypes[icon.iconName])
				this.decorationTypes[icon.iconName] = vs.window.createTextEditorDecorationType({
					gutterIconPath: vs.Uri.parse(iconUrlFormat.replace("$1", icon.iconName)),
					gutterIconSize: "80%",
				});
		});

		// Now build a map of all possible decorations, with those in this file. We need to include all
		// icons so if any were removed, we will clear their decorations.
		const decs: { [key: string]: vs.Range[] } = {};
		iconVisitor.icons.forEach((icon) => {
			if (!decs[icon.iconName])
				decs[icon.iconName] = [];

			decs[icon.iconName].push(toRange(this.activeEditor.document, icon.offset, icon.length));
		});

		for (const iconName of Object.keys(this.decorationTypes)) {
			this.activeEditor.setDecorations(
				this.decorationTypes[iconName],
				decs[iconName] || [],
			);
		}
	}

	private setTrackingFile(editor: vs.TextEditor) {
		if (editor && isAnalyzable(editor.document)) {
			this.activeEditor = editor;
		} else
			this.activeEditor = undefined;
	}

	public dispose() {
		this.activeEditor = undefined;
		this.subscriptions.forEach((s) => s.dispose());
	}
}
