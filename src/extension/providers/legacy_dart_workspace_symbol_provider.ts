import * as path from "path";
import { CancellationToken, Location, SymbolInformation, Uri, workspace, WorkspaceSymbolProvider } from "vscode";
import * as as from "../analysis/analysis_server_types";
import { Analyzer, getSymbolKindForElementKind } from "../analysis/analyzer";
import { fsPath, isWithinWorkspace, toRangeOnLine } from "../utils";

export class LegacyDartWorkspaceSymbolProvider implements WorkspaceSymbolProvider {
	constructor(private readonly analyzer: Analyzer) { }

	public provideWorkspaceSymbols(query: string, token: CancellationToken): Thenable<SymbolInformation[]> | undefined {
		if (query.length === 0)
			return undefined;
		query = this.sanitizeUserQuery(query);
		const pattern = this.makeCaseInsensitiveFuzzyRegex(query);
		return new Promise<SymbolInformation[]>((resolve, reject) => {
			Promise.all([
				this.analyzer.searchFindTopLevelDeclarationsResults({ pattern }),
				this.analyzer.searchFindMemberDeclarationsResults({ name: pattern }),
			]).then((results) => resolve(this.combineResults(results)), () => reject());
		});
	}

	private combineResults(results: as.SearchResultsNotification[]): SymbolInformation[] {
		return results[0].results.concat(results[1].results)
			.filter((r) => this.shouldIncludeResult(r))
			.map((r) => this.convertResult(r));
	}

	private searchTopLevelSymbols(query: string): PromiseLike<as.SearchResult[]> {
		const pattern = this.makeCaseInsensitiveFuzzyRegex(query);

		return this.analyzer.searchFindTopLevelDeclarationsResults({ pattern })
			.then((resp) => resp.results);
	}

	private searchMemberDeclarations(query: string): PromiseLike<as.SearchResult[]> {
		const pattern = this.makeCaseInsensitiveFuzzyRegex(query);
		return this.analyzer.searchFindMemberDeclarationsResults({ name: pattern })
			.then((resp) => resp.results);
	}

	private sanitizeUserQuery(query: string): string {
		let chars = Array.from(query);
		// Filter out special chars that will break regex.
		// searchFindTopLevelDeclarations supports regex, but we build the pattern with the output of this.
		// searchMemberDeclarations is not intended to support regex but does.
		chars = chars.filter((c) => {
			return "[](){}\\|./<>?+".indexOf(c) === -1;
		});
		return chars.join("");
	}

	private makeCaseInsensitiveFuzzyRegex(query: string): string {
		let chars = Array.from(query);
		chars = chars.map((c: string) => {
			if (c.toUpperCase() === c.toLowerCase())
				return c;
			return `[${c.toUpperCase()}${c.toLowerCase()}]`;
		});
		const pattern = chars.join(".*");
		return `.*${pattern}.*`;
	}

	private shouldIncludeResult(result: as.SearchResult): boolean {
		// Must be either:
		//   1. Public (not start with an underscore).
		//   2. In our project.
		const isPrivate = result.path[0].name.startsWith("_") || result.path[1].name.startsWith("_");

		return isWithinWorkspace(result.location.file) || !isPrivate;
	}

	private convertResult(result: as.SearchResult): SymbolInformation {
		// Rewrite the filename for best display.
		const containerName = this.createDisplayPath(result.location.file);

		// Remove the library and compilation unit parent elements; concatenate names.
		let elementPathDescription = result.path
			.slice(0, result.path.length - 2)
			.reverse()
			.map((e) => e.name)
			.join(".");

		// For properties, show if get/set.
		if (result.path[0].kind === "SETTER")
			elementPathDescription += " set";
		if (result.path[0].kind === "GETTER")
			elementPathDescription += " get";

		const parameters = result.path[0].parameters && result.path[0].kind !== "SETTER"
			? result.path[0].parameters
			: "";

		return new SymbolInformation(
			elementPathDescription + parameters,
			getSymbolKindForElementKind(result.path[0].kind),
			containerName,
			new Location(
				Uri.file(result.location.file),
				toRangeOnLine(result.location),
			),
		);
	}

	private createDisplayPath(inputPath: string): string {
		// HACK: The AS returns paths to the PUB_CACHE folder, which Code can't
		// convert to relative paths (so they look terrible). If the file exists in
		// workspace.rootPath we rewrite the path to there which gives us a nice
		// relative path.

		// Currently I only do this for "hosted\pub.dartlang.org" as I'm not sure of the
		// rules for these paths!

		const pubCachePath = "hosted" + path.sep + "pub.dartlang.org";
		const pubCachePathIndex = inputPath.indexOf(pubCachePath);
		if (pubCachePathIndex > -1) {
			const relativePath = inputPath.substring(pubCachePathIndex + pubCachePath.length + 1);

			// Packages in pubcache are versioned so trim the "-x.x.x" off the end of the foldername.
			const pathComponents = relativePath.split(path.sep);
			pathComponents[0] = pathComponents[0].split("-")[0];

			// Symlink goes into the lib folder, so strip that out of the path.
			if (pathComponents[1] === "lib")
				pathComponents.splice(1, 1);

			// Return 'package:foo/bar.dart'.
			inputPath = `package:${pathComponents[0]}/${pathComponents.slice(1).join("/")}`;
		} else {
			const root = workspace.getWorkspaceFolder(Uri.file(inputPath));
			inputPath = root && path.relative(fsPath(root.uri), inputPath);
		}

		return inputPath;
	}
}
