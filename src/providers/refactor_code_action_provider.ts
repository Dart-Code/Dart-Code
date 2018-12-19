import { CancellationToken, CodeAction, CodeActionContext, CodeActionKind, CodeActionProvider, CodeActionProviderMetadata, Range, TextDocument } from "vscode";
import * as as from "../analysis/analysis_server_types";
import { Analyzer } from "../analysis/analyzer";
import { fsPath, isAnalyzableAndInWorkspace } from "../utils";

const supportedRefactors: { [key: string]: string } = {
	CONVERT_METHOD_TO_GETTER: "Convert Method to Getter",
	EXTRACT_LOCAL_VARIABLE: "Extract Local Variable",
	EXTRACT_METHOD: "Extract Method",
	EXTRACT_WIDGET: "Extract Widget",
};

export class RefactorCodeActionProvider implements CodeActionProvider {
	constructor(private readonly analyzer: Analyzer) { }

	public readonly metadata: CodeActionProviderMetadata = {
		providedCodeActionKinds: [CodeActionKind.Refactor],
	};

	public provideCodeActions(document: TextDocument, range: Range, context: CodeActionContext, token: CancellationToken): Thenable<CodeAction[]> {
		if (!isAnalyzableAndInWorkspace(document))
			return null;
		return new Promise<CodeAction[]>((resolve, reject) => {
			this.analyzer.editGetAvailableRefactorings({
				file: fsPath(document.uri),
				length: document.offsetAt(range.end) - document.offsetAt(range.start),
				offset: document.offsetAt(range.start),
			}).then((result) => {
				const availableRefactors = result.kinds.map((k) => this.getRefactorForKind(document, range, k)).filter((r) => r);
				resolve(availableRefactors);
			}, (e) => {
				// TODO: Swap this back to logError/reject when https://github.com/dart-lang/sdk/issues/33471 is fixed.
				resolve([]);
				// logError(e);
				// reject();
			});
		});
	}

	private getRefactorForKind(document: TextDocument, range: Range, k: as.RefactoringKind): CodeAction {
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
