import * as vs from "vscode";
import { Analyzer } from "../analysis/analyzer";
import { isAnalyzable } from "../utils";

const nonBreakingSpace = "\xa0";

export class WidgetGuide {
	constructor(public readonly start: vs.Position, public readonly end: vs.Position) { }
}

export class TestLineDecorations implements vs.Disposable {
	private subscriptions: vs.Disposable[] = [];
	private activeEditor?: vs.TextEditor;

	private readonly borderDecoration = vs.window.createTextEditorDecorationType({
		rangeBehavior: vs.DecorationRangeBehavior.ClosedClosed,
	});

	constructor(private readonly analyzer: Analyzer) {
		this.subscriptions.push(vs.window.onDidChangeActiveTextEditor((e) => this.setTrackingFile(e)));
		this.subscriptions.push(vs.workspace.onDidChangeTextDocument(async (e) => this.setTrackingFile(await vs.window.showTextDocument(e.document))));
		if (vs.window.activeTextEditor)
			this.setTrackingFile(vs.window.activeTextEditor);

	}

	private indexesOf(searchString: string, input: string, startPosition = 0) {
		const results = [];
		let i = startPosition;
		// tslint:disable-next-line: no-conditional-assignment
		while ((i = input.indexOf(searchString, i + 1)) >= 0) {
			results.push(i);
			i++;
		}
		return results;
	}

	private update() {
		if (!this.activeEditor)
			return;

		const decorations: vs.DecorationOptions[] = [];

		const doc = this.activeEditor.document;
		const text = doc.getText();
		const demoStart = text.indexOf("// START-DEMO");
		const demoEnd = text.indexOf("// END-DEMO");
		const startIndex = text.indexOf("child: Column(", demoStart);

		const guides = this.indexesOf("KeyRow(<Widget>[", text, demoStart)
			.filter((i) => i <= demoEnd)
			.map(
				(i) => new WidgetGuide(doc.positionAt(startIndex), doc.positionAt(i)),
			);

		for (const guide of guides) {
			const startColumn = guide.start.character;
			const endLine = guide.end.line;

			for (let lineNumber = guide.start.line + 1; lineNumber <= guide.end.line - 1; lineNumber++) {
				decorations.push({
					range: new vs.Range(
						new vs.Position(lineNumber, 0),
						new vs.Position(lineNumber, 0),
					),
					renderOptions: {
						before: {
							contentText: nonBreakingSpace.repeat(startColumn) + "┃",
							width: "0",
						},
					},
				} as vs.DecorationOptions);
			}
			decorations.push({
				range: new vs.Range(
					new vs.Position(endLine, startColumn),
					new vs.Position(endLine, guide.end.character),
				),
				renderOptions: {
					before: {
						contentText: "┗" + "━".repeat(guide.end.character - startColumn - 1),
						width: "0",
					},
				},
			} as vs.DecorationOptions);
		}

		this.activeEditor.setDecorations(this.borderDecoration, decorations);
	}

	private setTrackingFile(editor: vs.TextEditor) {
		if (editor && isAnalyzable(editor.document)) {
			this.activeEditor = editor;
			this.update();
		} else
			this.activeEditor = undefined;
	}

	public dispose() {
		this.activeEditor = undefined;
		this.subscriptions.forEach((s) => s.dispose());
	}
}
