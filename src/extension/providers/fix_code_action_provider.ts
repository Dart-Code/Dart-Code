import { CancellationToken, CodeAction, CodeActionContext, CodeActionKind, CodeActionProviderMetadata, DocumentSelector, Range, TextDocument } from "vscode";
import * as as from "../../shared/analysis_server_types";
import { Logger } from "../../shared/interfaces";
import { fsPath } from "../../shared/utils/fs";
import { DasAnalyzerClient } from "../analysis/analyzer_das";
import { isAnalyzableAndInWorkspace } from "../utils";
import { DartDiagnosticProvider } from "./dart_diagnostic_provider";
import { RankedCodeActionProvider } from "./ranking_code_action_provider";

export class FixCodeActionProvider implements RankedCodeActionProvider {
	constructor(private readonly logger: Logger, public readonly selector: DocumentSelector, private readonly analyzer: DasAnalyzerClient) { }

	public readonly rank = 1;

	public readonly metadata: CodeActionProviderMetadata = {
		providedCodeActionKinds: [CodeActionKind.QuickFix],
	};

	public async provideCodeActions(document: TextDocument, range: Range, context: CodeActionContext, token: CancellationToken): Promise<CodeAction[] | undefined> {
		if (!isAnalyzableAndInWorkspace(document))
			return undefined;

		// If we were only asked for specific action types and that doesn't include
		// quickfix (which is all we supply), bail out.
		if (context && context.only && !CodeActionKind.QuickFix.contains(context.only))
			return undefined;

		try {
			const result = await this.analyzer.editGetFixes({
				file: fsPath(document.uri),
				offset: document.offsetAt(range.start),
			});
			if (token && token.isCancellationRequested)
				return;

			// Because fixes may be the same for multiple errors, we'll de-dupe them based on their edit.
			const allActions: { [key: string]: CodeAction } = {};

			for (const errorFix of result.fixes) {
				for (const fix of errorFix.fixes) {
					allActions[JSON.stringify(fix.edits)] = this.convertResult(document, fix, errorFix.error);
				}
			}

			const allFixes = Object.keys(allActions).map((a) => allActions[a]);

			return context.only
				? allFixes.filter((f) => context.only?.contains(f.kind!))
				: allFixes;
		} catch (e) {
			this.logger.error(e);
			throw e;
		}
	}

	private convertResult(document: TextDocument, change: as.SourceChange, error: as.AnalysisError): CodeAction {
		const title = change.message;
		const diagnostics = error ? [DartDiagnosticProvider.createDiagnostic(error)] : undefined;
		const kind = change.id
			? CodeActionKind.QuickFix.append(change.id.replace("dart.fix.", ""))
			: CodeActionKind.QuickFix;
		const action = new CodeAction(title, kind);
		action.command = {
			arguments: [document, change],
			command: "_dart.applySourceChange",
			title,
		};
		action.diagnostics = diagnostics;
		return action;
	}
}
