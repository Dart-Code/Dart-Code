import * as vs from "vscode";
import * as as from "../analysis/analysis_server_types";
import { Analyzer } from "../analysis/analyzer";
import { OpenFileTracker } from "../analysis/open_file_tracker";
import * as editors from "../editors";
import { fsPath, toRange } from "../utils";

export class GoToSuperCommand implements vs.Disposable {
	private disposables: vs.Disposable[] = [];
	private analyzer: Analyzer;

	constructor(analyzer: Analyzer) {
		this.analyzer = analyzer;

		this.disposables.push(vs.commands.registerCommand("dart.goToSuper", this.goToSuper, this));
	}

	private async goToSuper(): Promise<void> {
		if (!editors.hasActiveDartEditor()) {
			vs.window.showWarningMessage("No active Dart editor.");
			return;
		}

		const editor = vs.window.activeTextEditor;
		const document = editor.document;
		const offset = document.offsetAt(editor.selection.start);

		const outline = OpenFileTracker.getOutlineFor(document.uri);
		if (!outline) {
			vs.window.showWarningMessage("Outline not available.");
			return;
		}

		const outlineNode = this.findNode([outline], offset);
		if (!outlineNode) {
			vs.window.showWarningMessage("Go to Super Method only works for methods, getters and setters.");
			return;
		}

		const hierarchy = await this.analyzer.searchGetTypeHierarchy({
			file: fsPath(document.uri),
			offset: outlineNode.element.location.offset,
			superOnly: true,
		});

		if (!hierarchy || !hierarchy.hierarchyItems || !hierarchy.hierarchyItems.length || hierarchy.hierarchyItems.length === 1)
			return;

		// The first item is the current node, so skip that one and walk up till we find a matching member.
		const item = hierarchy.hierarchyItems.slice(1).find((h) => !!h.memberElement);
		const element = item && item.memberElement;

		if (!element)
			return;

		// TODO: extract out so we have one way of jumping to code
		// Currently we have Type Hierarchy, Go To Super, Flutter Outline
		{
			const location: as.Location = element.location;
			const document = await vs.workspace.openTextDocument(location.file);
			const editor = await vs.window.showTextDocument(document);
			const range = toRange(location);
			editor.revealRange(range, vs.TextEditorRevealType.InCenterIfOutsideViewport);
			editor.selection = new vs.Selection(range.end, range.start);
		}
	}

	private findNode(outlines: as.Outline[], offset: number): as.Outline | undefined {
		for (const outline of outlines) {
			const outlineStart = outline.offset;
			const outlineEnd = outline.offset + outline.length;

			// Bail if this node is not spanning us.
			if (outlineStart > offset || outlineEnd < offset)
				continue;

			if (outline.element.kind === "METHOD" || outline.element.kind === "GETTER" || outline.element.kind === "SETTER")
				return outline;
			else if (outline.children)
				return this.findNode(outline.children, offset);
		}
	}

	public dispose(): any {
		this.disposables.forEach((d) => d.dispose());
	}
}
