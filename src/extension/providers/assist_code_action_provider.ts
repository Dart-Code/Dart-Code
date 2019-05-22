import { CancellationToken, CodeAction, CodeActionContext, CodeActionKind, CodeActionProviderMetadata, DocumentSelector, Range, TextDocument } from "vscode";
import * as as from "../analysis/analysis_server_types";
import { Analyzer } from "../analysis/analyzer";
import { fsPath, isAnalyzableAndInWorkspace } from "../utils";
import { logError } from "../utils/log";
import { RankedCodeActionProvider } from "./ranking_code_action_provider";

export class AssistCodeActionProvider implements RankedCodeActionProvider {
	constructor(public readonly selector: DocumentSelector, private readonly analyzer: Analyzer) { }

	public readonly rank = 10;

	public readonly metadata: CodeActionProviderMetadata = {
		providedCodeActionKinds: [CodeActionKind.Refactor],
	};

	public provideCodeActions(document: TextDocument, range: Range, context: CodeActionContext, token: CancellationToken): Promise<CodeAction[]> | undefined {
		if (!isAnalyzableAndInWorkspace(document))
			return undefined;
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
		const action = new CodeAction(title, refactorId);
		action.command = {
			arguments: [document, change],
			command: "_dart.applySourceChange",
			title,
		};
		return action;
	}
}
