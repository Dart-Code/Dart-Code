import { CancellationToken, CodeAction, CodeActionContext, CodeActionKind, CodeActionProvider, CodeActionProviderMetadata, Range, TextDocument, WorkspaceEdit } from "vscode";
import { Analyzer } from "../analysis/analyzer";
import { config } from "../config";
import { isAnalyzableAndInWorkspace } from "../utils";
import { DartDiagnostic } from "./dart_diagnostic_provider";

export class IgnoreLintCodeActionProvider implements CodeActionProvider {
	constructor(private readonly analyzer: Analyzer) { }

	public readonly metadata: CodeActionProviderMetadata = {
		providedCodeActionKinds: [CodeActionKind.QuickFix],
	};

	public provideCodeActions(document: TextDocument, range: Range, context: CodeActionContext, token: CancellationToken): CodeAction[] {
		if (!isAnalyzableAndInWorkspace(document))
			return null;

		if (!config.showIgnoreQuickFixes || !context || !context.diagnostics || !context.diagnostics.length)
			return null;

		const lintErrors = context.diagnostics.filter((d) => d instanceof DartDiagnostic && (d.type === "LINT" || d.type === "HINT"));
		if (!lintErrors.length)
			return null;

		return lintErrors.map((diagnostic) => this.convertResult(document, diagnostic as DartDiagnostic));
	}

	private convertResult(document: TextDocument, diagnostic: DartDiagnostic): CodeAction {
		const edit = new WorkspaceEdit();
		const line = document.lineAt(diagnostic.range.start.line);
		edit.insert(
			document.uri,
			line.range.start,
			`${" ".repeat(line.firstNonWhitespaceCharacterIndex)}// ignore: ${diagnostic.code}\n`,
		);

		const title = `Ignore ${diagnostic.type.toLowerCase()} '${diagnostic.code}' for this line`;
		const action = new CodeAction(title, CodeActionKind.QuickFix);
		action.edit = edit;
		return action;
	}
}
