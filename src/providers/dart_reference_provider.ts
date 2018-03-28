import {
	ReferenceProvider, ReferenceContext, TextDocument, Location, Uri, Position, CancellationToken,
	CompletionItemProvider, CompletionList, CompletionItem, CompletionItemKind, TextEdit, Range, DefinitionProvider, Definition,
} from "vscode";
import { Analyzer } from "../analysis/analyzer";
import * as as from "../analysis/analysis_server_types";
import * as util from "../utils";

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
			file: document.fileName,
			includePotential: true,
			offset: document.offsetAt(position),
		});

		const locations = resp.results.map((result) => {
			return {
				range: util.toRange(result.location),
				uri: Uri.file(result.location.file),
			};
		});

		return definition
			? locations.concat(await definition)
			: locations;
	}

	public async provideDefinition(document: TextDocument, position: Position, token: CancellationToken): Promise<Definition> {
		const resp = await this.analyzer.analysisGetNavigation({
			file: document.fileName,
			length: 0,
			offset: document.offsetAt(position),
		});

		return resp.targets.map((target) => {
			// HACK: We sometimes get a startColumn of 0 (should be 1-based). Just treat this as 1 for now.
			//     See https://github.com/Dart-Code/Dart-Code/issues/200
			if (target.startColumn === 0)
				target.startColumn = 1;

			return {
				range: util.toRange(target),
				uri: Uri.file(resp.files[target.fileIndex]),
			};
		});
	}
}
