import { CancellationToken, CodeLens, CodeLensProvider, Event, EventEmitter, ProviderResult, TextDocument } from "vscode";
import { Analyzer } from "../analysis/analyzer";

export class TestCodeLensProvider implements CodeLensProvider {
	private onDidChangeCodeLensesEmitter: EventEmitter<void> = new EventEmitter<void>();
	public readonly onDidChangeCodeLenses: Event<void> = this.onDidChangeCodeLensesEmitter.event;

	constructor(public readonly analyzer: Analyzer) {
	}

	public provideCodeLenses(document: TextDocument, token: CancellationToken): ProviderResult<CodeLens[]> {
		return undefined;
	}
}
