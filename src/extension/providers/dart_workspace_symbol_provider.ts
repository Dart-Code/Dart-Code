import { CancellationToken, Location, SymbolInformation, SymbolKind, Uri, workspace, WorkspaceSymbolProvider } from "vscode";
import * as as from "../../shared/analysis_server_types";
import { Logger } from "../../shared/interfaces";
import { toRange } from "../../shared/vscode/utils";
import { DasAnalyzerClient, getSymbolKindForElementKind } from "../analysis/analyzer_das";

export class DartWorkspaceSymbolProvider implements WorkspaceSymbolProvider {
	private badChars: RegExp = new RegExp("[^0-9a-z\-]", "gi");
	constructor(private readonly logger: Logger, private readonly analyzer: DasAnalyzerClient) { }

	public async provideWorkspaceSymbols(query: string, token: CancellationToken): Promise<SymbolInformation[] | undefined> {
		if (query.length === 0)
			return undefined;

		// Turn query into a case-insensitive fuzzy search.
		const pattern = ".*" + query.replace(this.badChars, "").split("").map((c) => `[${c.toUpperCase()}${c.toLowerCase()}]`).join(".*") + ".*";
		const results = await this.analyzer.searchGetElementDeclarations({ pattern, maxResults: 500 });

		if (token && token.isCancellationRequested)
			return;

		return results.declarations.map((d) => this.convertWorkspaceResult(d, results.files[d.fileIndex]));
	}

	public async resolveWorkspaceSymbol(symbol: SymbolInformation, token: CancellationToken): Promise<SymbolInformation | undefined> {
		if (!(symbol instanceof PartialSymbolInformation))
			return undefined;

		const document = await workspace.openTextDocument(Uri.file(symbol.locationData.file));
		symbol.location = new Location(
			document.uri,
			toRange(document, symbol.locationData.offset, symbol.locationData.length),
		);

		return symbol;
	}

	private convertWorkspaceResult(result: as.ElementDeclaration, file: string): SymbolInformation {
		const nameSuffix = result.parameters ? (result.parameters === "()" ? "()" : "(…)") : "";
		const symbol: any = new PartialSymbolInformation(
			result.name + nameSuffix,
			getSymbolKindForElementKind(this.logger, result.kind),
			result.className || "",
			// HACK: Work around the incorrect typing in VS Code with !
			// https://github.com/microsoft/vscode/issues/69558
			new Location(Uri.file(file), undefined!),
			{
				file,
				length: result.codeLength,
				// Fall back to offset when the server gives us a bad codeOffset
				// https://github.com/dart-lang/sdk/issues/39192.
				offset: result.codeOffset || result.offset,
			},
		);

		return symbol;
	}
}

class PartialSymbolInformation extends SymbolInformation {
	constructor(
		name: string, kind: SymbolKind, containerName: string, location: Location,
		public readonly locationData: {
			readonly file: string;
			readonly offset: number;
			readonly length: number;
		}) {
		super(name, kind, containerName, location);
	}
}
