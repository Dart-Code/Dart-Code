import { CancellationToken, FoldingContext, FoldingRange, FoldingRangeKind, FoldingRangeProvider, TextDocument } from "vscode";
import { FoldingKind, FoldingRegion } from "../analysis/analysis_server_types";
import { Analyzer } from "../analysis/analyzer";
import { OpenFileTracker } from "../analysis/open_file_tracker";

export class DartFoldingProvider implements FoldingRangeProvider {
	constructor(private readonly analyzer: Analyzer) { }

	public async provideFoldingRanges(document: TextDocument, context: FoldingContext, token: CancellationToken): Promise<FoldingRange[]> {
		// Wait for any current analysis to complete (eg. if we've just opened a project it
		// may take a while to get the results).
		await this.analyzer.currentAnalysis;

		// Wait up to another few seconds after analysis completed (it might be that we opened a new
		// file and there was no analysis, in which case we're just waiting for the server to process
		// the newly added subscription and send results).
		let foldingRegions: FoldingRegion[];
		for (let i = 0; i < 5; i++) {
			foldingRegions = OpenFileTracker.getFoldingRegionsFor(document.uri);
			if (foldingRegions)
				break;
			await new Promise((resolve, reject) => setTimeout(resolve, i * 1000));
		}

		if (!foldingRegions)
			return;

		return foldingRegions.map((f) => new FoldingRange(
			document.positionAt(f.offset).line,
			document.positionAt(f.offset + f.length).line,
			this.getKind(f.kind),
		));
	}

	private getKind(kind: FoldingKind): FoldingRangeKind {
		switch (kind) {
			case "FILE_HEADER":
			case "DOCUMENTATION_COMMENT":
				return FoldingRangeKind.Comment;
			case "DIRECTIVES":
				return FoldingRangeKind.Imports;
		}
	}
}
