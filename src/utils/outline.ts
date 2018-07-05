import * as vs from "vscode";
import * as as from "../analysis/analysis_server_types";
import { OpenFileTracker } from "../analysis/open_file_tracker";

function findNode(outlines: as.Outline[], offset: number, kinds: as.ElementKind[]): as.Outline | undefined {
	if (!outlines)
		return null;
	for (const outline of outlines) {
		const outlineStart = outline.offset;
		const outlineEnd = outline.offset + outline.length;

		// Bail if this node is not spanning us.
		if (outlineStart > offset || outlineEnd < offset)
			continue;

		// Although we use the full code range above so that we can walk into children, when performing a match we want to stop
		// at the end of the element, so we use a reduce range to avoid returning a method for the whole of its body.
		const isInReducedRange = !outline.element || !outline.element.location
			|| (offset >= outlineStart && offset <= outline.element.location.offset + outline.element.location.length);

		return findNode(outline.children, offset, kinds)
			|| (kinds.indexOf(outline.element.kind) !== -1 && isInReducedRange ? outline : null);
	}
}

export function findNearestOutlineNode(document: vs.TextDocument, position: vs.Position, kinds: as.ElementKind[] = ["CLASS", "METHOD", "GETTER", "SETTER"]) {
	const outline = OpenFileTracker.getOutlineFor(document.uri);
	return outline && findNode([outline], document.offsetAt(position), kinds);
}
