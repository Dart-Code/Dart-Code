"use strict";

import { WorkspaceSymbolProvider, SymbolInformation, CancellationToken, SymbolKind, Location, Uri, Range, Position } from "vscode";
import { Analyzer } from "./analyzer";
import * as as from "./analysis_server_types";

export class DartWorkspaceSymbolProvider implements WorkspaceSymbolProvider {
	private analyzer: Analyzer;
	constructor(analyzer: Analyzer) {
		this.analyzer = analyzer;
	}

	provideWorkspaceSymbols(query: string, token: CancellationToken): Thenable<SymbolInformation[]> {
		return new Promise<SymbolInformation[]>((resolve, reject) => {
			this.analyzer.searchFindTopLevelDeclarations({ pattern: query }).then(resp => {
				var disposable = this.analyzer.registerForSearchResults(notification => {
					// Skip any results that are not ours (or are not the final results).
					if (notification.id != resp.id || !notification.isLast)
						return;

					disposable.dispose();
					resolve(notification.results.map(r => this.convertResult(r)));					
				})
			});
		});
	}

	private convertResult(result: as.SearchResult): SymbolInformation {
		let startPos = new Position(result.location.startLine - 1, result.location.startColumn - 1); // TODO: Abstract this out; esp as G are 1-based, MS 0-based!
		let endPos = startPos.translate(0, result.location.length);

		return {
			name: result.path[0].name,
			kind: this.getSymbolKind(result.path[0].kind),
			location: {
				uri: Uri.file(result.location.file),
				range: new Range(startPos, endPos)
			},
			containerName: result.path.length > 1 ? result.path[1].name : null
		};
	}

	private getSymbolKind(kind: as.ElementKind) : SymbolKind {
		// TODO: Review if these are all mapped as well as possible.
		switch (kind) {
			case "CLASS":
				return SymbolKind.Class;
			case "CLASS_TYPE_ALIAS":
				return SymbolKind.Class;
			case "COMPILATION_UNIT":
				return SymbolKind.Module;
			case "CONSTRUCTOR":
				return SymbolKind.Constructor;
			case "ENUM":
				return SymbolKind.Enum;
			case "ENUM_CONSTANT":
				return SymbolKind.Constant;
			case "FIELD":
				return SymbolKind.Field;
			case "FILE":
				return SymbolKind.File;
			case "FUNCTION":
				return SymbolKind.Function;
			case "FUNCTION_TYPE_ALIAS":
				return SymbolKind.Function;
			case "GETTER":
				return SymbolKind.Property;
			case "LABEL":
				return SymbolKind.Module;
			case "LIBRARY":
				return SymbolKind.Namespace;
			case "LOCAL_VARIABLE":
				return SymbolKind.Variable;
			case "METHOD":
				return SymbolKind.Method;
			case "PARAMETER":
				return SymbolKind.Variable;
			case "PREFIX":
				return SymbolKind.Variable;
			case "SETTER":
				return SymbolKind.Property;
			case "TOP_LEVEL_VARIABLE":
				return SymbolKind.Variable;
			case "TYPE_PARAMETER":
				return SymbolKind.Variable;
			case "UNIT_TEST_GROUP":
				return SymbolKind.Module;
			case "UNIT_TEST_TEST":
				return SymbolKind.Method;
			case "UNKNOWN":
				return SymbolKind.Object;
			default:
				throw new Error("Unknown kind: " + kind); 
		}
	}
}