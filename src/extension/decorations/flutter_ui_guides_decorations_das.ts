import * as vs from "vscode";
import * as as from "../../shared/analysis_server_types";
import { flatMap } from "../../shared/utils";
import { fsPath } from "../../shared/utils/fs";
import { DasAnalyzer } from "../analysis/analyzer_das";
import { FlutterUiGuideDecorations, WidgetGuide } from "./flutter_ui_guides_decorations";

export class FlutterUiGuideDecorationsDas extends FlutterUiGuideDecorations {
	constructor(private readonly analyzer: DasAnalyzer) {
		super();

		// Whenever we get a new Flutter Outline, if it's for the active document,
		// update that too.
		this.disposables.push(this.analyzer.client.registerForFlutterOutline((on) => {
			const editor = vs.window.activeTextEditor;
			if (editor && editor.document && fsPath(editor.document.uri) === on.file)
				this.buildFromOutline(editor, on.outline);
		}));
	}

	protected buildForTextEditor(editor: vs.TextEditor | undefined): void {
		if (editor && editor.document)
			this.buildFromOutline(editor, this.analyzer.fileTracker.getFlutterOutlineFor(editor.document.uri));
	}

	private buildFromOutline(editor: vs.TextEditor, outline: as.FlutterOutline | undefined): void {
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

	private extractGuides(document: vs.TextDocument, node: as.FlutterOutline): WidgetGuide[] {
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
					const firstCodeChar = this.firstNonWhitespace(document, childLine);
					guides.push(new WidgetGuide(startPos, firstCodeChar));
				});
			}
		}

		// Recurse down the tree to include childrens (and they'll include their
		// childrens, etc.).
		if (node.children)
			guides = guides.concat(flatMap(node.children, (c) => this.extractGuides(document, c)));

		return guides;
	}
}
