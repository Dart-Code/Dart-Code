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
		const guidesByLine: { [key: number]: WidgetGuide[] } = {};
		for (const guide of guides) {
			for (let line = guide.start.line; line <= guide.end.line; line++) {
				guidesByLine[line] = guidesByLine[line] || [];
				guidesByLine[line].push(guide);
			}
		}
		const decorations = this.getDecorations(doc, guidesByLine);

		editor.setDecorations(this.borderDecoration, decorations);
	}

	private getDecorations(doc: vs.TextDocument, guidesByLine: { [key: number]: WidgetGuide[] }): vs.DecorationOptions[] {
		const decorations: vs.DecorationOptions[] = [];
		for (const line of Object.keys(guidesByLine).map((k) => parseInt(k, 10))) {
			const lineInfo = doc.lineAt(line);
			const firstGuideChar = Math.min(...guidesByLine[line].map((g) => Math.min(g.start.character, g.end.character)));
			const lastGuideChar = Math.max(...guidesByLine[line].map((g) => Math.max(g.start.character, g.end.character)));
			const lastLineCharacter = lineInfo.range.end.character;
			const anchorPoint = lastLineCharacter < firstGuideChar ? 1 : firstGuideChar;

			const decorationString = new Array(lastGuideChar).fill(nonBreakingSpace);
			for (const guide of guidesByLine[line]) {
				if (line !== guide.end.line) {
					decorationString[guide.start.character] = verticalLine;
				} else {
					for (let c = guide.start.character; c <= guide.end.character; c++) {
						if (guide.isLast && c === guide.start.character) {
							decorationString[c] = bottomCorner;
						} else if (!guide.isLast && c === guide.start.character) {
							decorationString[c] = middleCorner;
						} else if (c === guide.start.character) {
							decorationString[c] = verticalLine;
						} else {
							decorationString[c] = horizontalLine;
						}
					}
				}
			}

			decorations.push({
				range: new vs.Range(
					new vs.Position(line, anchorPoint - 1),
					new vs.Position(line, anchorPoint - 1),
				),
				renderOptions: {
					before: {
						contentText: decorationString.join("").substring(anchorPoint),
						margin: "0 3px 0 -3px",
						width: "0",
					},
				},
			});
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
