import { CancellationToken, Definition, DefinitionProvider, Location, Position, ReferenceContext, ReferenceProvider, TextDocument, Uri } from "vscode";
import { Analyzer } from "../analysis/analyzer";
import * as util from "../utils";
import { fsPath } from "../utils";

export class DartReferenceProvider implements ReferenceProvider, DefinitionProvider {
	private analyzer: Analyzer;
	constructor(analyzer: Analyzer) {
		this.analyzer = analyzer;
	}

	public async provideReferences(document: TextDocument, position: Position, context: ReferenceContext, token: CancellationToken): Promise<Location[]> {
		// If we want to include the decleration, kick off a request for that.
		const definition = context.includeDeclaration
			? this.provideDefinition(document, position, token)
			: null;

		const resp = await this.analyzer.searchFindElementReferencesResults({
			file: fsPath(document.uri),
			includePotential: true,
			offset: document.offsetAt(position),
		});

		const locations = resp.results.map((result) => {
			return {
				range: util.toRangeOnLine(result.location),
				uri: Uri.file(result.location.file),
			};
		});

		return definition
			? locations.concat(await definition)
			: locations;
	}

	public async provideDefinition(document: TextDocument, position: Position, token: CancellationToken): Promise<Definition> {
		const resp = await this.analyzer.analysisGetNavigation({
			file: fsPath(document.uri),
			length: 0,
			offset: document.offsetAt(position),
		});

		return resp.targets.map((target) => {
			// HACK: We sometimes get a startColumn of 0 (should be 1-based). Just treat this as 1 for now.
			//     See https://github.com/Dart-Code/Dart-Code/issues/200
			if (target.startColumn === 0)
				target.startColumn = 1;

			return {
				range: util.toRangeOnLine(target),
				uri: Uri.file(resp.files[target.fileIndex]),
			};
		});
	}
}
