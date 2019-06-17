import { CancellationToken, CodeAction, CodeActionContext, CodeActionKind, CodeActionProviderMetadata, DocumentSelector, Range, TextDocument } from "vscode";
import * as as from "../../shared/analysis_server_types";
import { Logger } from "../../shared/interfaces";
import { fsPath } from "../../shared/vscode/utils";
import { Analyzer } from "../analysis/analyzer";
import { isAnalyzableAndInWorkspace } from "../utils";
import { RankedCodeActionProvider } from "./ranking_code_action_provider";

export class AssistCodeActionProvider implements RankedCodeActionProvider {
	constructor(private readonly logger: Logger, public readonly selector: DocumentSelector, private readonly analyzer: Analyzer) { }

	public readonly rank = 10;

	public readonly metadata: CodeActionProviderMetadata = {
		providedCodeActionKinds: [CodeActionKind.Refactor],
	};

	public async provideCodeActions(document: TextDocument, range: Range, context: CodeActionContext, token: CancellationToken): Promise<CodeAction[]> | undefined {
		if (!isAnalyzableAndInWorkspace(document))
			return undefined;
		// If we were only asked for specific action types and that doesn't include
		// refactor (which is all we supply), bail out.
		if (context && context.only && !context.only.contains(CodeActionKind.Refactor))
			return undefined;

		try {
			const assists = await this.analyzer.editGetAssists({
				file: fsPath(document.uri),
				length: range.end.character - range.start.character,
				offset: document.offsetAt(range.start),
			});
			return assists.assists.map((assist) => this.convertResult(document, assist));
		} catch (e) {
			this.logger.error(e);
		}
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
