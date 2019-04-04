import { CancellationToken, CodeAction, CodeActionContext, CodeActionKind, CodeActionProvider, CodeActionProviderMetadata, Range, TextDocument } from "vscode";
import * as as from "../analysis/analysis_server_types";
import { Analyzer } from "../analysis/analyzer";
import { fsPath, isAnalyzableAndInWorkspace } from "../utils";
import { logError } from "../utils/log";
import { DartDiagnosticProvider } from "./dart_diagnostic_provider";

export class FixCodeActionProvider implements CodeActionProvider {
	constructor(private readonly analyzer: Analyzer) { }

	public readonly metadata: CodeActionProviderMetadata = {
		providedCodeActionKinds: [CodeActionKind.QuickFix],
	};

	public async provideCodeActions(document: TextDocument, range: Range, context: CodeActionContext, token: CancellationToken): Promise<CodeAction[]> {
		if (!isAnalyzableAndInWorkspace(document))
			return null;
		try {
			const result = await this.analyzer.editGetFixes({
				file: fsPath(document.uri),
				offset: document.offsetAt(range.start),
			});
			// Because fixes may be the same for multiple errors, we'll de-dupe them based on their edit.
			const allActions: { [key: string]: CodeAction } = {};

			for (const errorFix of result.fixes) {
				for (const fix of errorFix.fixes) {
					allActions[JSON.stringify(fix.edits)] = this.convertResult(document, fix, errorFix.error);
				}
			}

			return Object.keys(allActions).map((a) => allActions[a]);
		} catch (e) {
			logError(e);
			throw e;
		}
	}

	private convertResult(document: TextDocument, change: as.SourceChange, error: as.AnalysisError): CodeAction {
		const title = change.message;
		const diagnostics = error ? [DartDiagnosticProvider.createDiagnostic(error)] : undefined;
		const action = new CodeAction(title, CodeActionKind.QuickFix);
		action.command = {
			arguments: [document, change],
			command: "_dart.applySourceChange",
			title,
		};
		action.diagnostics = diagnostics;
		return action;
	}
}
