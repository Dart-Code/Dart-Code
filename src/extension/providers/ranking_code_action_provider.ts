import { CancellationToken, CodeAction, CodeActionContext, CodeActionKind, CodeActionProvider, CodeActionProviderMetadata, Command, DocumentSelector, languages, Range, TextDocument } from "vscode";
import { flatMap, uniq } from "../../shared/utils";
import { sortBy } from "../../shared/utils/array";

export class RankingCodeActionProvider implements CodeActionProvider {
	private codeActionProviders: RankedCodeActionProvider[] = [];

	public registerProvider(provider: RankedCodeActionProvider): void {
		this.codeActionProviders.push(provider);
		sortBy(this.codeActionProviders, (p) => p.rank);
	}

	get metadata(): CodeActionProviderMetadata {
		const allKinds = flatMap(this.codeActionProviders, (p) => p.metadata.providedCodeActionKinds || []);
		return { providedCodeActionKinds: uniq(allKinds) };
	}

	public async provideCodeActions(document: TextDocument, range: Range, context: CodeActionContext, token: CancellationToken): Promise<Array<CodeAction | Command>> {
		// Sort the providers, because then their results will be sorted (flatMap doesn't change the order, and
		// Promise.all preserves order).
		const applicableProviders = this.codeActionProviders.filter((p) => languages.match(p.selector, document));
		const promises = applicableProviders.map((p) => p.provideCodeActions(document, range, context, token));
		const allResults = await Promise.all(promises);
		const flatResults = flatMap(allResults, (x) => x || []);
		return flatResults;
	}
}

export type RankedCodeActionProvider =
	CodeActionProvider
	& { selector: DocumentSelector }
	& { metadata: CodeActionProviderMetadata }
	& { rank: number };

export function getKindFor(id: string | undefined, base: CodeActionKind): CodeActionKind {
	if (!id)
		return base;
	const newID = id
		.replace("dart.assist.", "")
		.replace("dart.fix.", "")
		.replace("analysisOptions.assist.", "")
		.replace("analysisOptions.fix.", "");
	return base.append(newID);
}
