import { CancellationToken, DefinitionLink, DefinitionProvider, Location, Position, ReferenceContext, ReferenceProvider, TextDocument, Uri } from "vscode";
import { flatMap } from "../../shared/utils";
import { fsPath, toRange, toRangeOnLine } from "../../shared/vscode/utils";
import { Analyzer } from "../analysis/analyzer";

export class DartReferenceProvider implements ReferenceProvider, DefinitionProvider {
	constructor(private readonly analyzer: Analyzer) { }

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

		const locations = resp.results.map((result) => {
			return new Location(
				Uri.file(result.location.file),
				toRangeOnLine(result.location),
			);
		});

		return definitions
			? locations.concat(definitions.map((dl) => new Location(dl.targetUri, dl.targetRange)))
			: locations;
	}

	public async provideDefinition(document: TextDocument, position: Position, token: CancellationToken): Promise<DefinitionLink[]> {
		const resp = await this.analyzer.analysisGetNavigation({
			file: fsPath(document.uri),
			length: 0,
			offset: document.offsetAt(position),
		});

		if (token && token.isCancellationRequested)
			return;

		return flatMap(resp.regions, (region) => {
			return region.targets.map((targetIndex) => {
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
			});
		});
	}
}
