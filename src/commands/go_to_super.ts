import * as vs from "vscode";
import * as as from "../analysis/analysis_server_types";
import { Analyzer } from "../analysis/analyzer";
import * as editors from "../editors";
import { fsPath, toRangeOnLine } from "../utils";
import { findNearestOutlineNode } from "../utils/outline";

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
		const position = editor.selection.start;

		const outlineNode = findNearestOutlineNode(document, position);
		const offset = outlineNode ? outlineNode.element.location.offset : document.offsetAt(position);

		const hierarchy = await this.analyzer.searchGetTypeHierarchy({
			file: fsPath(document.uri),
			offset,
			superOnly: true,
		});

		if (!hierarchy || !hierarchy.hierarchyItems || !hierarchy.hierarchyItems.length || hierarchy.hierarchyItems.length === 1)
			return;

		// The first item is the current node, so skip that one and walk up till we find a matching member.
		const isClass = !hierarchy.hierarchyItems[0].memberElement;
		const item = hierarchy.hierarchyItems.slice(1).find((h) => isClass ? !!h.classElement : !!h.memberElement);
		const element = item && isClass ? item.classElement : item.memberElement;

		if (!element)
			return;

		// TODO: extract out so we have one way of jumping to code
		// Currently we have Type Hierarchy, Go To Super, Flutter Outline
		{
			const location: as.Location = element.location;
			const document = await vs.workspace.openTextDocument(location.file);
			const editor = await vs.window.showTextDocument(document);
			const range = toRangeOnLine(location);
			editor.revealRange(range, vs.TextEditorRevealType.InCenterIfOutsideViewport);
			editor.selection = new vs.Selection(range.end, range.start);
		}
	}

	public dispose(): any {
		this.disposables.forEach((d) => d.dispose());
	}
}
