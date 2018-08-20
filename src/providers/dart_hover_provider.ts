import { CancellationToken, Hover, HoverProvider, Position, Range, TextDocument, Uri } from "vscode";
import * as as from "../analysis/analysis_server_types";
import { Analyzer } from "../analysis/analyzer";
import { cleanDartdoc } from "../dartdocs";
import { PackageMap } from "../debug/package_map";
import { fsPath } from "../utils";
import { logError } from "../utils/log";

export class DartHoverProvider implements HoverProvider {
	constructor(private readonly analyzer: Analyzer) { }

	public provideHover(document: TextDocument, position: Position, token: CancellationToken): Thenable<Hover> {
		return new Promise<Hover>((resolve, reject) => {
			this.analyzer.analysisGetHover({
				file: fsPath(document.uri),
				offset: document.offsetAt(position),
			}).then((resp) => {
				if (resp.hovers.length === 0) {
					resolve(null);
				} else {
					const hover = resp.hovers[0];
					const data = this.getHoverData(document.uri, hover);
					if (data) {
						const range = new Range(
							document.positionAt(hover.offset),
							document.positionAt(hover.offset + hover.length),
						);
						resolve(new Hover(
							[{ language: "dart", value: data.displayString }, data.documentation || undefined],
							range,
						));
					} else {
						resolve(null);
					}
				}
			}, (e) => { logError(e); reject(); });
		});
	}

	private getHoverData(documentUri: Uri, hover: as.HoverInformation): any {
		if (!hover.elementDescription) return null;

		// Import prefix tooltips are not useful currently.
		// https://github.com/dart-lang/sdk/issues/32735
		if (hover.elementKind === "import prefix") return null;

		const elementDescription = hover.elementDescription;
		const elementKind = hover.elementKind;
		const dartdoc: string = hover.dartdoc;
		const containingClassDescription = hover.containingClassDescription;
		const propagatedType = hover.propagatedType;
		const staticType = hover.staticType;
		const callable = (elementKind === "function" || elementKind === "method");
		const field = (elementKind === "getter" || elementKind === "setter" || elementKind === "field");
		const containingLibraryName = hover.containingLibraryName;
		const containingLibraryPath = hover.containingLibraryPath;

		let displayString: string = "";
		if (elementDescription) displayString += (hover.isDeprecated ? "(deprecated) " : "") + elementDescription;
		if (propagatedType) displayString += ` (${propagatedType.trim()})`;
		if (staticType) displayString += ` (${staticType.trim()})`;

		let documentation = cleanDartdoc(dartdoc);
		if (containingLibraryName) {
			documentation = `*${containingLibraryName}*\n\n` + documentation;
		} else if (containingLibraryPath) {
			const packageMap = DartHoverProvider.getPackageMapFor(documentUri);
			const packagePath = packageMap && packageMap.convertFileToPackageUri(containingLibraryPath, false);
			const packageName = packagePath && packagePath.split("/")[0];
			if (packageName)
				documentation = `*${packageName}*\n\n` + documentation;
		}

		return {
			displayString: displayString.trim(),
			documentation,
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
