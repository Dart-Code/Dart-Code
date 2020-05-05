import * as vs from "vscode";
import * as lsp from "../../shared/analysis/lsp/custom_protocol";
import { flatMap } from "../../shared/utils";
import { fsPath } from "../../shared/utils/fs";
import { lspToPosition } from "../../shared/vscode/utils";
import { LspAnalyzer } from "../analysis/analyzer_lsp";
import { FlutterUiGuideDecorations, WidgetGuide } from "./flutter_ui_guides_decorations";

export class FlutterUiGuideDecorationsLsp extends FlutterUiGuideDecorations {
	constructor(private readonly analyzer: LspAnalyzer) {
		super();

		// Whenever we get a new Flutter Outline, if it's for the active document,
		// update that too.
		this.disposables.push(this.analyzer.fileTracker.onFlutterOutline.listen((op) => {
			const editor = vs.window.activeTextEditor;
			if (editor && editor.document && fsPath(editor.document.uri) === fsPath(op.uri))
				this.buildFromOutline(editor, op.outline);
		}));
	}

	protected buildForTextEditor(editor: vs.TextEditor | undefined): void {
		if (editor && editor.document)
			this.buildFromOutline(editor, this.analyzer.fileTracker.getFlutterOutlineFor(editor.document.uri));
	}

	private buildFromOutline(editor: vs.TextEditor, outline: lsp.FlutterOutline | undefined): void {
		if (this.tracker)
			this.tracker.clear();
		if (!editor || !editor.document || !outline)
			return;

		// Check that the outline we got looks like it still matches the document.
		// If the lengths are different, just bail without doing anything since
		// there have probably been new edits and we'll get a new outline soon.
		const outlineLength = editor.document.offsetAt(lspToPosition(outline.range.end));
		if (editor.document.getText().length !== outlineLength)
			return;

		const guides = this.extractGuides(editor.document, outline);
		if (this.tracker)
			this.tracker.trackDoc(editor.document, guides);
		this.renderGuides(editor, guides, "#A3A3A3");
	}

	private extractGuides(document: vs.TextDocument, node: lsp.FlutterOutline): WidgetGuide[] {
		let guides: WidgetGuide[] = [];
		if (node.kind === "NEW_INSTANCE") {
			const parentLine = node.codeRange.start.line;
			const childLines = node.children && node.children
				.map((c) => c.codeRange.start.line)
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
