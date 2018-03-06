import {
	TextDocument, Position, CancellationToken, CodeActionProvider, CodeActionContext,
	TextEdit, Range, Command, CodeAction, Diagnostic, CodeActionKind,
} from "vscode";
import { Analyzer } from "../analysis/analyzer";
import { logError, isAnalyzableAndInWorkspace } from "../utils";
import * as as from "../analysis/analysis_server_types";
import { DartDiagnosticProvider } from "./dart_diagnostic_provider";

export class AssistCodeActionProvider implements CodeActionProvider {
	private analyzer: Analyzer;
	constructor(analyzer: Analyzer) {
		this.analyzer = analyzer;
	}

	public provideCodeActions(document: TextDocument, range: Range, context: CodeActionContext, token: CancellationToken): Thenable<CodeAction[]> {
		// TODO: Should this just be isAnalyzable?
		if (!isAnalyzableAndInWorkspace(document))
			return null;
		return new Promise<CodeAction[]>((resolve, reject) => {
			this.analyzer.editGetAssists({
				file: document.fileName,
				length: range.end.character - range.start.character,
				offset: document.offsetAt(range.start),
			}).then((assists) => {
				const actions = assists.assists.map((assist) => this.convertResult(document, assist));
				resolve(actions);
			}, (e) => { logError(e); reject(); });
		});
	}

	private convertResult(document: TextDocument, change: as.SourceChange): CodeAction {
		const title = change.message;
		return {
			command: {
				arguments: [document, change],
				command: "_dart.applySourceChange",
				title,
			},
			kind: CodeActionKind.Refactor.append(change.id),
			title,
		};
	}
}
