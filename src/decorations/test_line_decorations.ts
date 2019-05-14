import * as vs from "vscode";
import { FlutterOutline } from "../analysis/analysis_server_types";
import { Analyzer } from "../analysis/analyzer";
import { flatMap } from "../debug/utils";
import { fsPath } from "../utils";

const nonBreakingSpace = "\xa0";

export class TestLineDecorations implements vs.Disposable {
	private disposables: vs.Disposable[] = [];

	private readonly borderDecoration = vs.window.createTextEditorDecorationType({
		rangeBehavior: vs.DecorationRangeBehavior.ClosedClosed,
	});

	constructor(private readonly analyzer: Analyzer) {
		// Update any editor that becomes active.
		this.disposables.push(vs.window.onDidChangeActiveTextEditor((e) => this.update(e)));
		// Update the current visible editor when we were registered.
		if (vs.window.activeTextEditor)
			this.update(vs.window.activeTextEditor);
		// Whenever we get a new Flutter Outline, if it's for the active document,
		// update that too.
		this.disposables.push(this.analyzer.registerForFlutterOutline((on) => {
			const editor = vs.window.activeTextEditor;
			if (editor && editor.document && fsPath(editor.document.uri) === on.file)
				this.update(editor, on.outline);
		}));
	}

	private update(editor: vs.TextEditor, outline?: FlutterOutline): Promise<void> {
		if (!editor || !editor.document)
			return;

		const doc = editor.document;

		// If we don't have an outline for this doc yet, we can't do anything.
		// If an Outline arrives later, the subscription above will automatically
		// trigger an update.
		if (!outline)
			return;

		// Check that the outline we got looks like it still matches the document.
		// If the lengths are different, just bail without doing anything since
		// there have probably been new edits and we'll get a new outline soon.
		if (doc.getText().length !== outline.length)
			return;

		const guides = this.extractGuides(doc, outline);
		const decorations = this.getDecorations(guides);

		editor.setDecorations(this.borderDecoration, decorations);
	}

	private getDecorations(guides: WidgetGuide[]): vs.DecorationOptions[] {
		const decorations: vs.DecorationOptions[] = [];
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
				});
			}
			const additionalEndIndent = guide.end.character - startColumn - 1;
			if (additionalEndIndent >= 0) {
				decorations.push({
					range: new vs.Range(
						new vs.Position(endLine, startColumn),
						new vs.Position(endLine, guide.end.character),
					),
					renderOptions: {
						before: {
							contentText: "┗" + "━".repeat(additionalEndIndent),
							width: "0",
						},
					},
				});
			}
		}
		return decorations;
	}

	private firstNonWhitespace(document: vs.TextDocument, lineNumber: number): vs.Position {
		return new vs.Position(
			lineNumber,
			document.lineAt(lineNumber).firstNonWhitespaceCharacterIndex,
		);
	}

	private extractGuides(document: vs.TextDocument, node: FlutterOutline): WidgetGuide[] {
		let guides: WidgetGuide[] = [];
		if (node.kind === "NEW_INSTANCE") {
			const parentLine = document.positionAt(node.offset).line;
			const childLines = node.children && node.children.map((c) => document.positionAt(c.offset).line).filter((cl) => cl > parentLine);
			if (childLines) {
				const parentLineStart = this.firstNonWhitespace(document, parentLine);
				for (const childLine of childLines) {
					const childLineStart = this.firstNonWhitespace(document, childLine);
					guides.push(new WidgetGuide(parentLineStart, childLineStart));
				}
			}
		}

		// Recurse down the tree to include childrens (and they'll include their
		// childrens, etc.).
		if (node.children)
			guides = guides.concat(flatMap(node.children, (c) => this.extractGuides(document, c)));

		return guides;
	}

	public dispose() {
		this.disposables.forEach((s) => s.dispose());
	}
}

export class WidgetGuide {
	constructor(public readonly start: vs.Position, public readonly end: vs.Position) { }
}
