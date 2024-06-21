import { CancellationToken, Hover, HoverProvider, Position, Range, TextDocument, Uri } from "vscode";
import * as as from "../../shared/analysis_server_types";
import { Logger } from "../../shared/interfaces";
import { fsPath } from "../../shared/utils/fs";
import { cleanDartdoc } from "../../shared/vscode/extension_utils";
import { DasAnalyzerClient } from "../analysis/analyzer_das";

export class DartHoverProvider implements HoverProvider {
	constructor(private readonly logger: Logger, private readonly analyzer: DasAnalyzerClient) { }

	public async provideHover(document: TextDocument, position: Position, token: CancellationToken): Promise<Hover | undefined> {
		try {
			const resp = await this.analyzer.analysisGetHover({
				file: fsPath(document.uri),
				offset: document.offsetAt(position),
			});

			if (token.isCancellationRequested || resp.hovers.length === 0)
				return;

			const hover = resp.hovers[0];
			const data = this.getHoverData(document.uri, hover);

			if (!data)
				return;

			const range = new Range(
				document.positionAt(hover.offset),
				document.positionAt(hover.offset + hover.length),
			);
			return new Hover(
				[{ language: "dart", value: data.displayString }, data.documentation || undefined],
				range.isSingleLine ? range : undefined, // Workaround for https://github.com/dart-lang/sdk/issues/35386
			);
		} catch (e) {
			this.logger.error(e);
		}
	}

	private getHoverData(documentUri: Uri, hover: as.HoverInformation): any {
		if (!hover.elementDescription) return undefined;

		// Import prefix tooltips are not useful currently.
		// https://github.com/dart-lang/sdk/issues/32735
		if (hover.elementKind === "import prefix") return undefined;

		const elementDescription = hover.elementDescription;
		const dartdoc: string | undefined = hover.dartdoc;
		const propagatedType = hover.propagatedType;

		let displayString = "";
		if (elementDescription) displayString += (hover.isDeprecated ? "(deprecated) " : "") + `${elementDescription}\n`;
		if (propagatedType) displayString += `propagated type: ${propagatedType.trim()}`;

		let documentation = cleanDartdoc(dartdoc);
		const containingLibraryName = hover.containingLibraryName;
		if (containingLibraryName)
			documentation = `*${containingLibraryName}*\n\n` + documentation;

		return {
			displayString: displayString.trim(),
			documentation: documentation.trim(),
		};
	}
}
