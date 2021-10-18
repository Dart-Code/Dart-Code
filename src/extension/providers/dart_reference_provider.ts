import { CancellationToken, DefinitionLink, DefinitionProvider, Location, Position, ReferenceContext, ReferenceProvider, TextDocument, Uri } from "vscode";
import { flatMap } from "../../shared/utils";
import { fsPath } from "../../shared/utils/fs";
import { toRange, toRangeOnLine } from "../../shared/vscode/utils";
import { DasAnalyzerClient } from "../analysis/analyzer_das";
import { DasFileTracker } from "../analysis/file_tracker_das";

export class DartReferenceProvider implements ReferenceProvider, DefinitionProvider {
	constructor(private readonly analyzer: DasAnalyzerClient, private readonly fileTracker: DasFileTracker) { }

	public async provideReferences(document: TextDocument, position: Position, context: ReferenceContext, token: CancellationToken): Promise<Location[] | undefined> {
		// If we want to include the decleration, kick off a request for that.
		const definitions = context.includeDeclaration
			? await this.provideDefinition(document, position, token)
			: undefined;

		const resp = await this.analyzer.searchFindElementReferencesResults({
			file: fsPath(document.uri),
			includePotential: true,
			offset: document.offsetAt(position),
		});

		if (token && token.isCancellationRequested)
			return;

		const locations = resp.results.map((result) => new Location(
			Uri.file(result.location.file),
			toRangeOnLine(result.location),
		));

		return definitions
			? locations.concat(definitions.map((dl) => new Location(dl.targetUri, dl.targetRange)))
			: locations;
	}

	public async provideDefinition(document: TextDocument, position: Position, token: CancellationToken): Promise<DefinitionLink[] | undefined> {
		let resp1 = this.fileTracker.getNavigationTargets(fsPath(document.uri), document.offsetAt(position));
		if (!resp1) {
			resp1 = await this.analyzer.analysisGetNavigation({
				file: fsPath(document.uri),
				length: 0,
				offset: document.offsetAt(position),
			});
		}
		if (!resp1) return undefined;
		const resp = resp1;

		if (token && token.isCancellationRequested)
			return;

		const definitions = flatMap(resp.regions, (region) => region.targets.map((targetIndex) => {
			const target = resp.targets[targetIndex];
			// HACK: We sometimes get a startColumn of 0 (should be 1-based). Just treat this as 1 for now.
			//     See https://github.com/Dart-Code/Dart-Code/issues/200
			if (target.startColumn === 0)
				target.startColumn = 1;

			return {
				originSelectionRange: toRange(document, region.offset, region.length),
				targetRange: toRangeOnLine(target),
				targetUri: Uri.file(resp.files[target.fileIndex]),
			} as DefinitionLink;
		}));

		// For some locations (for example on the "var" keyword ), we'll get multiple results
		// where some of them are the location we invoked at, or the name of the variable. If
		// there are any results that are on a different line/different file to where we were
		// invoked, return only those. If the only results are on the same line of the same
		// file then just return them all.
		const definitionsOnOtherLines = definitions
			.filter((d) => fsPath(d.targetUri) !== fsPath(document.uri)
				|| d.targetRange.start.line !== position.line);

		return definitionsOnOtherLines.length ? definitionsOnOtherLines : definitions;
	}
}
