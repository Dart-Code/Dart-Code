import {
	CancellationToken, CodeAction, CodeActionContext, CodeActionKind, CodeActionProvider,
	Command, Diagnostic, Position, Range, TextDocument, TextEdit, CodeActionProviderMetadata,
} from "vscode";
import * as as from "../analysis/analysis_server_types";
import { Analyzer } from "../analysis/analyzer";
import { isAnalyzableAndInWorkspace, logError, fsPath } from "../utils";
import { DartDiagnosticProvider } from "./dart_diagnostic_provider";

export class OrganizeDirectivesCodeActionProvider implements CodeActionProvider {
	private analyzer: Analyzer;
	constructor(analyzer: Analyzer) {
		this.analyzer = analyzer;
	}

	public readonly metadata: CodeActionProviderMetadata = {
		providedCodeActionKinds: [CodeActionKind.SourceOrganizeImports],
	};

	public provideCodeActions(document: TextDocument, range: Range, context: CodeActionContext, token: CancellationToken): CodeAction[] {
		if (!isAnalyzableAndInWorkspace(document))
			return null;
		return [{
			command: {
				command: "_dart.organizeDirectives",
				title: "Organize Directives",
			},
			kind: CodeActionKind.SourceOrganizeImports,
			title: "Organize Directives",
		}];
	}
}
