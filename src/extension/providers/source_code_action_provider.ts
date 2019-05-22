import { CancellationToken, CodeAction, CodeActionContext, CodeActionKind, CodeActionProvider, CodeActionProviderMetadata, Range, TextDocument } from "vscode";
import { isAnalyzableAndInWorkspace } from "../utils";

const SourceSortMembers = CodeActionKind.Source.append("sortMembers");

export class SourceCodeActionProvider implements CodeActionProvider {
	public readonly metadata: CodeActionProviderMetadata = {
		providedCodeActionKinds: [CodeActionKind.SourceOrganizeImports, SourceSortMembers],
	};

	public provideCodeActions(document: TextDocument, range: Range, context: CodeActionContext, token: CancellationToken): CodeAction[] | undefined {
		if (!isAnalyzableAndInWorkspace(document))
			return undefined;
		return [{
			command: {
				arguments: [document],
				command: "_dart.organizeImports",
				title: "Organize Imports",
			},
			kind: CodeActionKind.SourceOrganizeImports,
			title: "Organize Imports",
		}, {
			command: {
				arguments: [document],
				command: "dart.sortMembers",
				title: "Sort Members",
			},
			kind: SourceSortMembers,
			title: "Sort Members",
		}];
	}
}
