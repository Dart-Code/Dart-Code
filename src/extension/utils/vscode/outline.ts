import * as vs from "vscode";
import * as as from "../../../shared/analysis_server_types";
import { openFileTracker } from "../../analysis/open_file_tracker";

export function findNearestOutlineNode(document: vs.TextDocument, position: vs.Position, useReducedRange = false, kinds: as.ElementKind[] = ["CLASS", "METHOD", "GETTER", "SETTER"]) {
	const outline = openFileTracker.getOutlineFor(document.uri);
	return outline && findNode([outline], document.offsetAt(position), useReducedRange, kinds);
}

function findNode(outlines: as.Outline[] | undefined, offset: number, useReducedRange: boolean, kinds: as.ElementKind[]): as.Outline | undefined {
	if (!outlines)
		return undefined;
	for (const outline of outlines) {
		const outlineStart = outline.offset;
		const outlineEnd = outline.offset + outline.length;

		// Bail if this node is not spanning us.
		if (outlineStart > offset || outlineEnd < offset)
			continue;

		// Although we use the full code range above so that we can walk into children, when performing a match we want to stop
		// at the end of the element, so we use a reduce range to avoid returning a method for the whole of its body.
		const isInReducedRange = !useReducedRange || !outline.element || !outline.element.location
			|| (offset >= outlineStart && offset <= outline.element.location.offset + outline.element.location.length);

		return findNode(outline.children, offset, useReducedRange, kinds)
			|| (kinds.indexOf(outline.element.kind) !== -1 && isInReducedRange ? outline : undefined);
	}
}
