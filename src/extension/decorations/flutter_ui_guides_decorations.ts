import * as vs from "vscode";
import { flatMap } from "../../shared/utils";
import { DocumentPositionTracker } from "../../shared/vscode/trackers";
import { config } from "../config";

const nonBreakingSpace = "\xa0";
const verticalLine = "│";
const horizontalLine = "─";
const bottomCorner = "└";
const middleCorner = "├";

export abstract class FlutterUiGuideDecorations implements vs.Disposable {
	protected disposables: vs.Disposable[] = [];
	protected tracker: WidgetGuideTracker | undefined;

	private readonly borderDecoration = vs.window.createTextEditorDecorationType({
		rangeBehavior: vs.DecorationRangeBehavior.OpenOpen,
	});

	constructor() {
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
		setImmediate(() => this.buildForTextEditor(vs.window.activeTextEditor));
	}

	protected abstract buildForTextEditor(editor: vs.TextEditor | undefined): void;

	private buildFromUpdatedGuides(doc: vs.TextDocument, guides: WidgetGuide[]) {
		if (vs.window.activeTextEditor && vs.window.activeTextEditor.document === doc)
			this.renderGuides(vs.window.activeTextEditor, guides, "#A3A3A3" /*"#FFA3A3"*/);
	}

	protected renderGuides(editor: vs.TextEditor, guides: WidgetGuide[], color: string) {
		const guidesByLine: { [key: number]: WidgetGuide[]; } = {};
		for (const guide of guides) {
			for (let line = guide.start.line; line <= guide.end.line; line++) {
				guidesByLine[line] = guidesByLine[line] || [];
				guidesByLine[line].push(guide);
			}
		}
		const decorations = this.buildDecorations(editor.document, editor.options.tabSize as number, guidesByLine, color);
		editor.setDecorations(this.borderDecoration, decorations);
	}

	private buildDecorations(doc: vs.TextDocument, tabSize: number, guidesByLine: { [key: number]: WidgetGuide[] }, color: string): vs.DecorationOptions[] {
		const decorations: vs.DecorationOptions[] = [];
		for (const line of Object.keys(guidesByLine).map((k) => parseInt(k, 10))) {
			const lineInfo = doc.lineAt(line);

			const firstGuideChar = Math.min(...guidesByLine[line].map((g) => Math.min(g.start.character, g.end.character)));
			const lastGuideChar = Math.max(...guidesByLine[line].map((g) => Math.max(g.start.character, g.end.character)));
			const lastLineCharacter = lineInfo.range.end.character;
			const anchorPoint = Math.max(lastLineCharacter < firstGuideChar ? 0 : firstGuideChar, 0);

			const decorationString: string[] = new Array(lastGuideChar).fill(nonBreakingSpace);
			for (const guide of guidesByLine[line]) {
				if (line !== guide.end.line) {
					// Only put a vertical line in if we haven't already o
					if (decorationString[guide.start.character] === nonBreakingSpace)
						decorationString[guide.start.character] = verticalLine;
					else if (decorationString[guide.start.character] === bottomCorner)
						decorationString[guide.start.character] = middleCorner;
				} else {
					for (let c = guide.start.character; c <= guide.end.character; c++) {
						if (c === guide.start.character) {
							decorationString[c] = bottomCorner;
						} else {
							decorationString[c] = horizontalLine;
						}
					}
				}
			}

			// For any characters that have users text in them, we should not
			// render any guides.
			decorationString.fill(nonBreakingSpace, lineInfo.firstNonWhitespaceCharacterIndex, lineInfo.range.end.character);

			decorationString.splice(0, anchorPoint);

			// For any tabs in the document string, we need to multiply up the characters
			// by the tab width, since everything up to this point is based on the text line
			// character indexes, but rendering needs to obey tab size.
			const tabAdjustedDecorationString: string[] = [];
			for (let i = 0; i < decorationString.length; i++) {
				tabAdjustedDecorationString.push(decorationString[i]);
				if (lineInfo.text[anchorPoint + i] === "\t") {
					const padCharacter =
						decorationString[i] === horizontalLine || decorationString[i] === bottomCorner || decorationString[i] === middleCorner
							? horizontalLine
							: nonBreakingSpace;
					for (let c = 0; c < tabSize - 1; c++)
						tabAdjustedDecorationString.push(padCharacter);
				}
			}

			decorations.push({
				range: new vs.Range(
					new vs.Position(line, anchorPoint),
					new vs.Position(line, anchorPoint),
				),
				renderOptions: {
					before: {
						color,
						contentText: tabAdjustedDecorationString.join(""),
						margin: "0 3px 0 -3px",
						width: "0",
					},
				},
			});
		}
		return decorations;
	}

	protected firstNonWhitespace(document: vs.TextDocument, lineNumber: number): vs.Position {
		return new vs.Position(
			lineNumber,
			document.lineAt(lineNumber).firstNonWhitespaceCharacterIndex,
		);
	}

	public dispose() {
		this.disposables.forEach((s) => s.dispose());
	}
}

export class WidgetGuide {
	constructor(public readonly start: vs.Position, public readonly end: vs.Position) { }
}

class WidgetGuideTracker implements vs.Disposable {
	private readonly disposables: vs.Disposable[] = [];
	private readonly tracker: DocumentPositionTracker = new DocumentPositionTracker();
	private readonly guideMap: Map<WidgetGuide, [vs.Position, vs.Position]> = new Map<WidgetGuide, [vs.Position, vs.Position]>();

	private onGuidesChangedEmitter = new vs.EventEmitter<[vs.TextDocument, WidgetGuide[]]>();
	public readonly onGuidesChanged = this.onGuidesChangedEmitter.event;

	constructor() {
		this.disposables.push(this.tracker);

		this.tracker.onPositionsChanged(([doc, positions]) => {
			// Map all our original positions onto new positions based on their
			// new offsets.
			const newGuides: WidgetGuide[] = [];
			for (const guide of this.guideMap.keys()) {
				const data = this.guideMap.get(guide)!;
				const currentStartPos = data[0];
				const currentEndPos = data[1];

				const newStartPos = positions.get(currentStartPos);
				const newEndPos = positions.get(currentEndPos);
				if (newStartPos && newEndPos)
					newGuides.push(new WidgetGuide(newStartPos, newEndPos));
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
			this.guideMap.set(guide, [guide.start, guide.end]);

		// Extract a flat list of positions to track.
		const positions = flatMap([...this.guideMap.values()], (g) => [g[0], g[1]]);
		this.tracker.trackDoc(document, positions);
	}

	public dispose() {
		this.disposables.forEach((s) => s.dispose());
	}
}
