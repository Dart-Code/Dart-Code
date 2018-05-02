import { CancellationToken, CodeAction, CodeActionContext, CodeActionKind, CodeActionProvider, CodeActionProviderMetadata, Range, TextDocument } from "vscode";
import * as as from "../analysis/analysis_server_types";
import { Analyzer } from "../analysis/analyzer";
import { fsPath, isAnalyzableAndInWorkspace, logError } from "../utils";

export class AssistCodeActionProvider implements CodeActionProvider {
	private analyzer: Analyzer;
	constructor(analyzer: Analyzer) {
		this.analyzer = analyzer;
	}

	public readonly metadata: CodeActionProviderMetadata = {
		providedCodeActionKinds: [CodeActionKind.Refactor],
	};

	public provideCodeActions(document: TextDocument, range: Range, context: CodeActionContext, token: CancellationToken): Thenable<CodeAction[]> {
		if (!isAnalyzableAndInWorkspace(document))
			return null;
		return new Promise<CodeAction[]>((resolve, reject) => {
			this.analyzer.editGetAssists({
				file: fsPath(document.uri),
				length: range.end.character - range.start.character,
				offset: document.offsetAt(range.start),
			}).then((assists) => {
				const actions = assists.assists.map((assist) => this.convertResult(document, assist));
				resolve(actions);
			}, (e) => { logError(e); reject(); });
		});
	}

	private convertResult(document: TextDocument, change: as.SourceChange): CodeAction {
		const title = change.message;
		const refactorId = change.id
			? CodeActionKind.Refactor.append(change.id.replace("dart.assist.", ""))
			: CodeActionKind.Refactor;
		return {
			command: {
				arguments: [document, change],
				command: "_dart.applySourceChange",
				title,
			},
			kind: refactorId,
			title,
		};
	}
}
