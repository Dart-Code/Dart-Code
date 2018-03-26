import {
	CancellationToken, CodeAction, CodeActionContext, CodeActionKind, CodeActionProvider,
	Command, Diagnostic, Position, Range, TextDocument, TextEdit,
} from "vscode";
import * as as from "../analysis/analysis_server_types";
import { Analyzer } from "../analysis/analyzer";
import { isAnalyzableAndInWorkspace, logError } from "../utils";

const supportedRefactors: { [key: string]: string } = {
	EXTRACT_METHOD: "Extract Method",
};

export class RefactorCodeActionProvider implements CodeActionProvider {
	private analyzer: Analyzer;
	constructor(analyzer: Analyzer) {
		this.analyzer = analyzer;
	}

	public provideCodeActions(document: TextDocument, range: Range, context: CodeActionContext, token: CancellationToken): Thenable<CodeAction[]> {
		if (!isAnalyzableAndInWorkspace(document))
			return null;
		return new Promise<CodeAction[]>((resolve, reject) => {
			this.analyzer.editGetAvailableRefactorings({
				file: document.fileName,
				length: document.offsetAt(range.end) - document.offsetAt(range.start),
				offset: document.offsetAt(range.start),
			}).then((result) => {
				const availableRefactors = result.kinds.map((k) => this.getRefactorForKind(document, range, k)).filter((r) => r);

				resolve(availableRefactors);
			}, (e) => { logError(e); reject(); });
		});
	}

	private getRefactorForKind(document: TextDocument, range: Range, k: as.RefactoringKind): CodeAction {
		if (!supportedRefactors[k])
			return;

		const title = supportedRefactors[k];

		return {
			command: {
				arguments: [document, range, k],
				command: "_dart.performRefactor",
				title,
			},
			kind: CodeActionKind.Refactor,
			title,
		};
	}
}
