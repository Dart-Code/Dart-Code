import * as vs from "vscode";
import { flatMap } from "../../shared/utils";
import { fsPath } from "../../shared/vscode/utils";
import { FlutterOutline } from "../analysis/analysis_server_types";
import { Analyzer } from "../analysis/analyzer";
import { openFileTracker } from "../analysis/open_file_tracker";
import { config } from "../config";
import { DocumentPositionTracker } from "../editing/trackers";

const nonBreakingSpace = "\xa0";
const verticalLine = "│";
const horizontalLine = "─";
const bottomCorner = "└";
const middleCorner = "├";

export class FlutterUiGuideDecorations implements vs.Disposable {
	private disposables: vs.Disposable[] = [];
	private tracker: WidgetGuideTracker | undefined;

	private readonly borderDecoration = vs.window.createTextEditorDecorationType({
		rangeBehavior: vs.DecorationRangeBehavior.OpenOpen,
	});

	constructor(private readonly analyzer: Analyzer) {
		// Update any editor that becomes active.
		this.disposables.push(vs.window.onDidChangeActiveTextEditor((e) => this.buildForTextEditor(e)));

		if (config.previewFlutterUiGuidesCustomTracking) {
			this.tracker = new WidgetGuideTracker();
			this.disposables.push(this.tracker);

			// Subscribe to updates from the tracker so we can update on keypress without
			// waiting for new Outlines.
			this.tracker.onGuidesChanged(([doc, guides]) => this.buildFromUpdatedGuides(doc, guides));
		}

		// Update the current visible editor when we were registered.
		if (vs.window.activeTextEditor)
			this.buildForTextEditor(vs.window.activeTextEditor);

		// Whenever we get a new Flutter Outline, if it's for the active document,
		// update that too.
		this.disposables.push(this.analyzer.registerForFlutterOutline((on) => {
			const editor = vs.window.activeTextEditor;
			if (editor && editor.document && fsPath(editor.document.uri) === on.file)
				this.buildFromOutline(editor, on.outline);
		}));
	}

	private buildForTextEditor(editor: vs.TextEditor): void {
		if (editor && editor.document)
			this.buildFromOutline(editor, openFileTracker.getFlutterOutlineFor(editor.document.uri));
	}

	private buildFromOutline(editor: vs.TextEditor, outline: FlutterOutline | undefined): void {
		if (this.tracker)
			this.tracker.clear();
		if (!editor || !editor.document || !outline)
			return;

		// Check that the outline we got looks like it still matches the document.
		// If the lengths are different, just bail without doing anything since
		// there have probably been new edits and we'll get a new outline soon.
		if (editor.document.getText().length !== outline.length)
			return;

		const guides = this.extractGuides(editor.document, outline);
		if (this.tracker)
			this.tracker.trackDoc(editor.document, guides);
		this.renderGuides(editor, guides, "#A3A3A3");
	}

	private buildFromUpdatedGuides(doc: vs.TextDocument, guides: WidgetGuide[]) {
		if (vs.window.activeTextEditor && vs.window.activeTextEditor.document === doc)
			this.renderGuides(vs.window.activeTextEditor, guides, "#A3A3A3" /*"#FFA3A3"*/);
	}

	private renderGuides(editor: vs.TextEditor, guides: WidgetGuide[], color: string) {
		const guidesByLine: { [key: number]: WidgetGuide[]; } = {};
		for (const guide of guides) {
			for (let line = guide.start.line; line <= guide.end.line; line++) {
				guidesByLine[line] = guidesByLine[line] || [];
				guidesByLine[line].push(guide);
			}
		}
		const decorations = this.buildDecorations(editor.document, guidesByLine, color);
		editor.setDecorations(this.borderDecoration, decorations);
	}

	private buildDecorations(doc: vs.TextDocument, guidesByLine: { [key: number]: WidgetGuide[] }, color: string): vs.DecorationOptions[] {
		const decorations: vs.DecorationOptions[] = [];
		for (const line of Object.keys(guidesByLine).map((k) => parseInt(k, 10))) {
			const lineInfo = doc.lineAt(line);
			const firstGuideChar = Math.min(...guidesByLine[line].map((g) => Math.min(g.start.character, g.end.character)));
			const lastGuideChar = Math.max(...guidesByLine[line].map((g) => Math.max(g.start.character, g.end.character)));
			const lastLineCharacter = lineInfo.range.end.character;
			const anchorPoint = lastLineCharacter < firstGuideChar ? 0 : firstGuideChar;

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

			// For any characters that have users text in them, we should not
			// render any guides.
			decorationString.fill(nonBreakingSpace, lineInfo.firstNonWhitespaceCharacterIndex, lineInfo.range.end.character);

			decorations.push({
				range: new vs.Range(
					new vs.Position(line, Math.max(anchorPoint, 0)),
					new vs.Position(line, Math.max(anchorPoint, 0)),
				),
				renderOptions: {
					before: {
						color,
						contentText: decorationString.join("").substring(Math.max(anchorPoint, 0)),
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
				const startPos = this
					.firstNonWhitespace(document, parentLine);
				childLines.forEach((childLine, i) => {
					const isLast = i === childLines.length - 1;
					const firstCodeChar = this.firstNonWhitespace(document, childLine);
					guides.push(new WidgetGuide(startPos, firstCodeChar, isLast));
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

class WidgetGuideTracker implements vs.Disposable {
	private readonly disposables: vs.Disposable[] = [];
	private readonly tracker: DocumentPositionTracker = new DocumentPositionTracker();
	private readonly guideMap: Map<WidgetGuide, [vs.Position, vs.Position, boolean]> = new Map<WidgetGuide, [vs.Position, vs.Position, boolean]>();

	private onGuidesChangedEmitter = new vs.EventEmitter<[vs.TextDocument, WidgetGuide[]]>();
	public readonly onGuidesChanged = this.onGuidesChangedEmitter.event;

	constructor() {
		this.disposables.push(this.tracker);

		this.tracker.onPositionsChanged(([doc, positions]) => {
			// Map all our original positions onto new positions based on their
			// new offsets.
			const newGuides: WidgetGuide[] = [];
			for (const guide of this.guideMap.keys()) {
				const data = this.guideMap.get(guide);
				const currentStartPos = data[0];
				const currentEndPos = data[1];
				const isLast = data[2];

				const newStartPos = positions.get(currentStartPos);
				const newEndPos = positions.get(currentEndPos);
				if (newStartPos && newEndPos)
					newGuides.push(new WidgetGuide(newStartPos, newEndPos, isLast));
			}

			this.onGuidesChangedEmitter.fire([doc, newGuides]);
		});
	}

	public clear(): void {
		this.guideMap.clear();
		this.tracker.clear();
	}

	public trackDoc(document: vs.TextDocument, guides: WidgetGuide[]): void {
		// Stash all guides as tuples containing their positions.
		this.guideMap.clear();
		for (const guide of guides)
			this.guideMap.set(guide, [guide.start, guide.end, guide.isLast]);

		// Extract a flat list of positions to track.
		const positions = flatMap([...this.guideMap.values()], (g) => [g[0], g[1]]);
		this.tracker.trackDoc(document, positions);
	}

	public dispose() {
		this.disposables.forEach((s) => s.dispose());
	}
}
