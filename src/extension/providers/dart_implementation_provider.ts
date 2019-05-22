import * as vs from "vscode";
import { flatMap } from "../../shared/utils";
import { fsPath } from "../../shared/vscode/utils";
import * as as from "../analysis/analysis_server_types";
import { Analyzer } from "../analysis/analyzer";
import { toRange } from "../utils";
import { findNearestOutlineNode } from "../utils/vscode/outline";

export class DartImplementationProvider implements vs.ImplementationProvider {
	constructor(readonly analyzer: Analyzer) { }

	public async provideImplementation(document: vs.TextDocument, position: vs.Position, token: vs.CancellationToken): Promise<vs.Definition> {
		// Try to use the Outline data to snap our location to a node.
		// For example in:
		//
		//     void b();
		//
		// The search.getTypeHierarchy call will only work over "b" but by using outline we
		// can support the whole "void b();".
		const outlineNode = findNearestOutlineNode(document, position, true);
		const offset = outlineNode ? outlineNode.element.location.offset : document.offsetAt(position);

		const hierarchy = await this.analyzer.searchGetTypeHierarchy({
			file: fsPath(document.uri),
			offset,
		});

		if (!hierarchy || !hierarchy.hierarchyItems || !hierarchy.hierarchyItems.length || hierarchy.hierarchyItems.length === 1)
			return;

		// Find the element we started with, since we only want implementations (not super classes).
		const currentItem = hierarchy.hierarchyItems.find((h) => {
			const elm = h.memberElement || h.classElement;
			return elm.location.offset <= offset && elm.location.offset + elm.location.length >= offset;
		})
			// If we didn't find the element when we might have been at a call site, so we'll have to start
			// at the root.
			|| hierarchy.hierarchyItems[0];

		const isClass = !currentItem.memberElement;
		function getDescendants(item: as.TypeHierarchyItem): as.TypeHierarchyItem[] {
			return [
				...item.subclasses.map((i) => hierarchy.hierarchyItems[i]),
				...flatMap(item.subclasses, (i) => getDescendants(hierarchy.hierarchyItems[i])),
			];
		}
		const descendants = getDescendants(currentItem)
			.map((d) => isClass ? d.classElement : d.memberElement)
			.filter((d) => d);

		const locations: vs.Location[] = [];
		for (const element of descendants) {
			const range = toRange(
				await vs.workspace.openTextDocument(element.location.file),
				element.location.offset,
				element.location.length,
			);

			locations.push(new vs.Location(vs.Uri.file(element.location.file), range));
		}

		return locations;
	}
}
