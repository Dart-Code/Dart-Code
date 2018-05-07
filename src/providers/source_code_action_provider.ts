import { CancellationToken, CodeAction, CodeActionContext, CodeActionKind, CodeActionProvider, CodeActionProviderMetadata, Range, TextDocument } from "vscode";
import { Analyzer } from "../analysis/analyzer";
import { isAnalyzableAndInWorkspace } from "../utils";

const SourceSortMembers = CodeActionKind.Source.append("sortMembers");

export class SourceCodeActionProvider implements CodeActionProvider {
	private analyzer: Analyzer;
	constructor(analyzer: Analyzer) {
		this.analyzer = analyzer;
	}

	public readonly metadata: CodeActionProviderMetadata = {
		providedCodeActionKinds: [CodeActionKind.SourceOrganizeImports, SourceSortMembers],
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
		}, {
			command: {
				command: "dart.sortMembers",
				title: "Sort Members",
			},
			kind: SourceSortMembers,
			title: "Sort Members",
		}];
	}
}
