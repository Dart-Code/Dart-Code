import { CancellationToken, CodeAction, CodeActionContext, CodeActionKind, CodeActionProvider, CodeActionProviderMetadata, Range, TextDocument } from "vscode";
import { Analyzer } from "../analysis/analyzer";
import { isAnalyzableAndInWorkspace } from "../utils";

export class OrganizeImportsCodeActionProvider implements CodeActionProvider {
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
				command: "_dart.organizeImports",
				title: "Organize Imports",
			},
			kind: CodeActionKind.SourceOrganizeImports,
			title: "Organize Imports",
		}];
	}
}
