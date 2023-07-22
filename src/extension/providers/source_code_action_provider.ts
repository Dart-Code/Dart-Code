import { CancellationToken, CodeAction, CodeActionContext, CodeActionKind, CodeActionProvider, CodeActionProviderMetadata, Range, TextDocument } from "vscode";
import { SourceSortMembersCodeActionKind } from "../../shared/vscode/utils";
import { isAnalyzableAndInWorkspace } from "../utils";

export class SourceCodeActionProvider implements CodeActionProvider {
	public static readonly metadata: CodeActionProviderMetadata = {
		providedCodeActionKinds: [CodeActionKind.Source, CodeActionKind.SourceOrganizeImports, SourceSortMembersCodeActionKind],
	};

	public provideCodeActions(document: TextDocument, range: Range, context: CodeActionContext, token: CancellationToken): CodeAction[] | undefined {
		if (!isAnalyzableAndInWorkspace(document))
			return undefined;

		const actions = [];

		const organizeImportsCodeAction = {
			command: {
			  arguments: [document],
			  command: "_dart.organizeImports",
			  title: "Organize Imports",
			},
			kind: CodeActionKind.SourceOrganizeImports,
			title: "Organize Imports",
		  };
		  const sortMembersCodeAction = {
			command: {
			  arguments: [document],
			  command: "dart.sortMembers",
			  title: "Sort Members",
			},
			kind: SourceSortMembersCodeActionKind,
			title: "Sort Members",
		  };
		  if (!context || !context.only || context.only.contains(CodeActionKind.Source) || context.only.contains(CodeActionKind.SourceOrganizeImports)) {
			actions.push(organizeImportsCodeAction);
		  }
		  if (!context || !context.only || context.only.contains(CodeActionKind.Source) || context.only.contains(SourceSortMembersCodeActionKind)) {
			actions.push(sortMembersCodeAction);
		  }

		return actions;
	}
}
