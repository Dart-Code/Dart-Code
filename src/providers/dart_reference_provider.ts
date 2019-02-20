import { CancellationToken, DefinitionLink, DefinitionProvider, Location, Position, ReferenceContext, ReferenceProvider, TextDocument, Uri } from "vscode";
import { Analyzer } from "../analysis/analyzer";
import { flatMap } from "../debug/utils";
import * as util from "../utils";
import { fsPath } from "../utils";

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

		const locations = resp.results.map((result) => {
			return new Location(
				Uri.file(result.location.file),
				util.toRangeOnLine(result.location),
			);
		});

		return definitions
			? locations.concat(definitions.map((dl) => new Location(dl.targetUri, dl.targetRange)))
			: locations;
	}

	public async provideDefinition(document: TextDocument, position: Position, token: CancellationToken | undefined): Promise<DefinitionLink[]> {
		const resp = await this.analyzer.analysisGetNavigation({
			file: fsPath(document.uri),
			length: 0,
			offset: document.offsetAt(position),
		});

		return flatMap(resp.regions, (region) => {
			return region.targets.map((targetIndex) => {
				const target = resp.targets[targetIndex];
				// HACK: We sometimes get a startColumn of 0 (should be 1-based). Just treat this as 1 for now.
				//     See https://github.com/Dart-Code/Dart-Code/issues/200
				if (target.startColumn === 0)
					target.startColumn = 1;

				return {
					originSelectionRange: util.toRange(document, region.offset, region.length),
					targetRange: util.toRangeOnLine(target),
					targetUri: Uri.file(resp.files[target.fileIndex]),
				} as DefinitionLink;
			});
		});
	}
}
