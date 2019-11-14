import { CancellationToken, CodeAction, CodeActionContext, CodeActionKind, CodeActionProviderMetadata, DocumentSelector, Range, TextDocument } from "vscode";
import * as as from "../../shared/analysis_server_types";
import { fsPath } from "../../shared/vscode/utils";
import { isAnalyzableAndInWorkspace, notUndefined } from "../utils";
import { DasAnalyzerClient } from "../analysis/analyzer_das";
import { RankedCodeActionProvider } from "./ranking_code_action_provider";

const supportedRefactors: { [key: string]: string } = {
	CONVERT_METHOD_TO_GETTER: "Convert Method to Getter",
	EXTRACT_LOCAL_VARIABLE: "Extract Local Variable",
	EXTRACT_METHOD: "Extract Method",
	EXTRACT_WIDGET: "Extract Widget",
};

export class RefactorCodeActionProvider implements RankedCodeActionProvider {
	constructor(public readonly selector: DocumentSelector, private readonly analyzer: DasAnalyzerClient) { }

	public readonly rank = 50;

	public readonly metadata: CodeActionProviderMetadata = {
		providedCodeActionKinds: [CodeActionKind.Refactor],
	};

	public async provideCodeActions(document: TextDocument, range: Range, context: CodeActionContext, token: CancellationToken): Promise<CodeAction[] | undefined> {
		if (!isAnalyzableAndInWorkspace(document))
			return undefined;

		// If we were only asked for specific action types and that doesn't include
		// refactor (which is all we supply), bail out.
		if (context && context.only && !CodeActionKind.Refactor.contains(context.only))
			return undefined;

		try {
			const result = await this.analyzer.editGetAvailableRefactorings({
				file: fsPath(document.uri),
				length: document.offsetAt(range.end) - document.offsetAt(range.start),
				offset: document.offsetAt(range.start),
			});
			if (token && token.isCancellationRequested)
				return;
			return result.kinds.map((k) => this.getRefactorForKind(document, range, k)).filter(notUndefined);
		} catch (e) {
			// TODO: Swap this back to logError/throw when https://github.com/dart-lang/sdk/issues/33471 is fixed.
			return [];
			// logError(e);
			// reject();
		}
	}

	private getRefactorForKind(document: TextDocument, range: Range, k: as.RefactoringKind): CodeAction | undefined {
		if (!supportedRefactors[k])
			return;

		const title = supportedRefactors[k];
		const action = new CodeAction(title, CodeActionKind.Refactor);
		action.command = {
			arguments: [document, range, k],
			command: "_dart.performRefactor",
			title,
		};
		return action;
	}
}
