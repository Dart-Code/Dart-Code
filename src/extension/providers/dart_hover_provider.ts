import { CancellationToken, Hover, HoverProvider, Position, Range, TextDocument, Uri } from "vscode";
import * as as from "../../shared/analysis_server_types";
import { Logger } from "../../shared/interfaces";
import { PackageMap } from "../../shared/pub/package_map";
import { cleanDartdoc } from "../../shared/utils/dartdocs";
import { fsPath } from "../../shared/vscode/utils";
import { Analyzer } from "../analysis/analyzer";

export class DartHoverProvider implements HoverProvider {
	constructor(private readonly logger: Logger, private readonly analyzer: Analyzer) { }

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

		let displayString: string = "";
		if (elementDescription) displayString += (hover.isDeprecated ? "(deprecated) " : "") + `${elementDescription}\n`;
		if (propagatedType) displayString += `propogated type: ${propagatedType.trim()}`;

		let documentation = cleanDartdoc(dartdoc);
		if (this.analyzer.capabilities.hasNewHoverLibraryFormat) {
			if (hover.containingLibraryName)
				documentation = `*${hover.containingLibraryName}*\n\n` + documentation;
		} else {
			const containingLibraryName = hover.containingLibraryName;
			const containingLibraryPath = hover.containingLibraryPath;
			if (containingLibraryName) {
				documentation = `*${containingLibraryName}*\n\n` + documentation;
			} else if (containingLibraryPath) {
				const packageMap = DartHoverProvider.getPackageMapFor(documentUri);
				const packagePath = packageMap && packageMap.convertFileToPackageUri(containingLibraryPath, false);
				const packageName = packagePath && packagePath.split("/")[0];
				if (packageName)
					documentation = `*${packageName}*\n\n` + documentation;
			}
		}

		return {
			displayString: displayString.trim(),
			documentation: documentation.trim(),
		};
	}

	// TODO: Update this when things change?
	private static packageMaps: { [key: string]: PackageMap } = {};
	private static getPackageMapFor(uri: Uri): PackageMap {
		const path = fsPath(uri);
		if (this.packageMaps[path])
			return this.packageMaps[path];

		const packagesFile = PackageMap.findPackagesFile(path);
		const map = packagesFile && new PackageMap(packagesFile);
		if (map)
			this.packageMaps[path] = map;
		return map;
	}
	// TODO: Don't expose this publicly, subsribe to some event to clear it.
	public static clearPackageMapCaches() {
		this.packageMaps = {};
	}
}
