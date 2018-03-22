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
				// Because fixes may be the same for multiple errors, we'll de-dupe them based on their edit.
				const allActions: { [key: string]: CodeAction } = {};

				for (const errorFix of result.fixes) {
					for (const fix of errorFix.fixes) {
						allActions[JSON.stringify(fix.edits)] = this.convertResult(document, fix, errorFix.error);
					}
				}

				resolve(Object.keys(allActions).map((a) => allActions[a]));
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
