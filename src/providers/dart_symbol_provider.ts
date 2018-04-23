import { WorkspaceSymbolProvider, SymbolInformation, CancellationToken, SymbolKind, Location, Uri, Range, Position, workspace, DocumentSymbolProvider, TextDocument } from "vscode";
import * as path from "path";
import * as fs from "fs";
import { Analyzer, getSymbolKindForElementKind } from "../analysis/analyzer";
import { toRange, isWithinWorkspace, logError, escapeRegExp, fsPath } from "../utils";
import * as as from "../analysis/analysis_server_types";

export class DartSymbolProvider implements WorkspaceSymbolProvider, DocumentSymbolProvider {
	private analyzer: Analyzer;
	private badChars: RegExp = new RegExp("[^0-9a-z\-]", "gi");
	constructor(analyzer: Analyzer) {
		this.analyzer = analyzer;
	}

	public async provideWorkspaceSymbols(query: string, token: CancellationToken): Promise<SymbolInformation[]> {
		if (query.length === 0)
			return null;

		// Turn query into a case-insensitive fuzzy search.
		const pattern = ".*" + query.replace(this.badChars, "").split("").map((c) => `[${c.toUpperCase()}${c.toLowerCase()}]`).join(".*") + ".*";
		const results = await this.analyzer.searchGetElementDeclarations({ pattern });

		return results.declarations.map((d) => this.convertResult(d, results.files[d.fileIndex], true));
	}

	public async provideDocumentSymbols(document: TextDocument, token: CancellationToken): Promise<SymbolInformation[]> {
		const results = await this.analyzer.searchGetElementDeclarations({ file: document.fileName });
		return results.declarations.map((d) => this.convertResult(d, results.files[d.fileIndex], false));
	}

	private convertResult(result: as.ElementDeclaration, file: string, includeFilename: boolean): SymbolInformation {
		let name = result.name;

		// Constructors don't come prefixed with class name, so add them for a nice display:
		//    () => MyClass()
		//    named() => MyClass.named()
		let nameIsPrefixedWithClass = false;
		if (result.kind === "CONSTRUCTOR" && result.className) {
			if (name) {
				nameIsPrefixedWithClass = true;
				name = `${result.className}.${name}`;
			} else {
				name = result.className;
			}
		}

		if (result.parameters && result.kind !== "SETTER")
			name += result.parameters;

		let containerName = "";
		if (includeFilename) {
			containerName = this.createDisplayPath(file);
			if (result.className && !nameIsPrefixedWithClass)
				name = `${result.className}.${name}`;
		} else {
			containerName = result.className || "";
		}

		return {
			containerName,
			kind: getSymbolKindForElementKind(result.kind),
			location: {
				range: toRange({ startLine: result.line, startColumn: result.column, length: 0 }),
				uri: Uri.file(file),
			},
			name,
		};
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
