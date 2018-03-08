import {
	CancellationToken, CodeAction, CodeActionContext, CodeActionKind, CodeActionProvider,
	Command, Diagnostic, Position, Range, TextDocument, TextEdit,
} from "vscode";
import * as as from "../analysis/analysis_server_types";
import { Analyzer } from "../analysis/analyzer";
import { isAnalyzableAndInWorkspace, logError } from "../utils";
import { DartDiagnosticProvider } from "./dart_diagnostic_provider";

export class FixCodeActionProvider implements CodeActionProvider {
	private analyzer: Analyzer;
	constructor(analyzer: Analyzer) {
		this.analyzer = analyzer;
	}

	public provideCodeActions(document: TextDocument, range: Range, context: CodeActionContext, token: CancellationToken): Thenable<CodeAction[]> {
		if (!isAnalyzableAndInWorkspace(document))
			return null;
		return new Promise<CodeAction[]>((resolve, reject) => {
			this.analyzer.editGetFixes({
				file: document.fileName,
				offset: document.offsetAt(range.start),
			}).then((result) => {
				const allActions = new Array<CodeAction>();

				for (const errorFix of result.fixes)
					allActions.push(...errorFix.fixes.map((fix) => this.convertResult(document, fix, errorFix.error)));

				resolve(allActions);
			}, (e) => { logError(e); reject(); });
		});
	}

	private convertResult(document: TextDocument, change: as.SourceChange, error: as.AnalysisError): CodeAction {
		const title = change.message;
		const diagnostics = error ? [DartDiagnosticProvider.createDiagnostic(error)] : undefined;
		return {
			command: {
				arguments: [document, change],
				command: "_dart.applySourceChange",
				title,
			},
			diagnostics,
			kind: CodeActionKind.QuickFix,
			title,
		};
	}
}
