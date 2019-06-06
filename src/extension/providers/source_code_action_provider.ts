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
		// If we were only asked for specific action types and that doesn't include
		// source (which is all we supply), bail out.
		if (context && context.only && !context.only.contains(CodeActionKind.Source))
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
