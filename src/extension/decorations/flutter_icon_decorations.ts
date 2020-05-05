import * as vs from "vscode";
import { Logger } from "../../shared/interfaces";
import { docsIconPathFormat } from "../../shared/vscode/extension_utils";
import { isAnalyzable } from "../utils";

export abstract class FlutterIconDecorations implements vs.Disposable {
	protected readonly subscriptions: vs.Disposable[] = [];
	protected activeEditor?: vs.TextEditor;

	private readonly decorationTypes: { [key: string]: vs.TextEditorDecorationType } = {};

	constructor(protected readonly logger: Logger) {
		this.subscriptions.push(vs.window.onDidChangeActiveTextEditor((e) => {
			this.setTrackingFile(e);
			this.update();
		}));
		setImmediate(() => {
			this.setTrackingFile(vs.window.activeTextEditor);
			this.update();
		});
	}

	protected abstract update(): void;

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
		this.subscriptions.forEach((s) => s.dispose());
	}
}
