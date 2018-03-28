import {
	DefinitionProvider, Definition, TextDocument, Location, Uri, Position, CancellationToken,
	CompletionItemProvider, CompletionList, CompletionItem, CompletionItemKind, TextEdit, Range,
} from "vscode";
import { Analyzer } from "../analysis/analyzer";
import * as as from "../analysis/analysis_server_types";
import * as util from "../utils";

export class DartDefinitionProvider implements DefinitionProvider {
	private analyzer: Analyzer;
	constructor(analyzer: Analyzer) {
		this.analyzer = analyzer;
	}

	public async provideDefinition(document: TextDocument, position: Position, token: CancellationToken): Promise<Definition> {
		const resp = await this.analyzer.analysisGetNavigation({
			file: document.fileName,
			length: 0,
			offset: document.offsetAt(position),
		});

		return resp.targets.map((t) => this.convertResult(t, resp.files[t.fileIndex]));
	}

	private convertResult(target: as.NavigationTarget, file: string): Location {
		// HACK: We sometimes get a startColumn of 0 (should be 1-based). Just treat this as 1 for now.
		//     See https://github.com/Dart-Code/Dart-Code/issues/200
		if (target.startColumn === 0)
			target.startColumn = 1;

		return {
			range: util.toRange(target),
			uri: Uri.file(file),
		};
	}
}
