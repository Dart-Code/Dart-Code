import * as vs from "vscode";
import { FlutterOutline } from "../analysis/analysis_server_types";
import { Analyzer } from "../analysis/analyzer";
import { flatMap } from "../debug/utils";
import { fsPath } from "../utils";

const nonBreakingSpace = "\xa0";
const verticalLine = "│";
const horizontalLine = "─";
const bottomCorner = "└";
const middleCorner = "├";

export class FlutterUiGuideDecorations implements vs.Disposable {
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

			// Add a vertical line for each line except the last one.
			for (let lineNumber = guide.start.line; lineNumber <= guide.end.line - 1; lineNumber++) {
				if (startColumn >= 1)
					decorations.push(this.getDecoration(lineNumber, nonBreakingSpace.repeat(startColumn - 1) + verticalLine));
			}

			// Add the horizontal line at the bottom.
			// character = last line to draw,
			const numHorizontalLines = guide.end.character - startColumn;
			const corner = guide.isLast ? bottomCorner : middleCorner;
			if (numHorizontalLines >= 0) {
				decorations.push(
					this.getDecoration(
						endLine,
						nonBreakingSpace.repeat(startColumn - 1) + corner + horizontalLine.repeat(numHorizontalLines),
					),
				);
			}
		}
		return decorations;
	}

	private getDecoration(lineNumber: number, contentText: string): vs.DecorationOptions {
		return {
			range: this.startOfLine(lineNumber),
			renderOptions: {
				before: {
					contentText,
					width: "0",
				},
			},
		};
	}

	private startOfLine(lineNumber: number): vs.Range {
		return new vs.Range(
			new vs.Position(lineNumber, 0),
			new vs.Position(lineNumber, 0),
		);
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
			const childLines = node.children && node.children
				.map((c) => document.positionAt(c.offset).line)
				.filter((cl) => cl > parentLine);
			if (childLines) {
				// Get the start of the line, then offset by 1,1 for where the
				// line will start. We do this here so that the recorded start
				// position is always where the line starts drawing (not the
				// character it's pointing at) so that for children we can use
				// the previous childs end point to avoid overlapping lots
				// of lines (which is visible, due to stacked aliasing).
				let startPos = this
					.firstNonWhitespace(document, parentLine)
					.translate({ lineDelta: 1, characterDelta: 1 });
				childLines.forEach((childLine, i) => {
					const isLast = i === childLines.length - 1;
					// Same for child, offset to get the character where the line
					// should end.
					const firstChar = this.firstNonWhitespace(document, childLine);
					if (firstChar.character > 1) {
						const childLineStart = firstChar.translate({ characterDelta: -1 });
						guides.push(new WidgetGuide(startPos, childLineStart, isLast));
						// Record the position just udner the "bottom corner" as the
						// start point for the next child.
						startPos = new vs.Position(childLine + 1, startPos.character);
					}
				});
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
	constructor(public readonly start: vs.Position, public readonly end: vs.Position, public readonly isLast: boolean) { }
}
