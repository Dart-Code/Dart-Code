"use strict";

import {
	TextDocument, Position, CancellationToken, CodeActionProvider, CodeActionContext,
	TextEdit, Range, Command, CodeAction, Diagnostic, CodeActionKind,
} from "vscode";
import { Analyzer } from "../analysis/analyzer";
import { logError, isAnalyzableAndInWorkspace } from "../utils";
import * as as from "../analysis/analysis_server_types";
import { DartDiagnosticProvider } from "./dart_diagnostic_provider";

export class DartCodeActionProvider implements CodeActionProvider {
	private analyzer: Analyzer;
	constructor(analyzer: Analyzer) {
		this.analyzer = analyzer;
	}

	public provideCodeActions(document: TextDocument, range: Range, context: CodeActionContext, token: CancellationToken): Thenable<CodeAction[]> {
		if (!isAnalyzableAndInWorkspace(document))
			return null;
		return new Promise<CodeAction[]>((resolve, reject) => {
			Promise.all([
				this.analyzer.editGetFixes({
					file: document.fileName,
					offset: document.offsetAt(range.start),
				}),
				this.analyzer.editGetAssists({
					file: document.fileName,
					length: range.end.character - range.start.character,
					offset: document.offsetAt(range.start),
				}),
			]).then((results) => {
				const fixes = results[0] as as.EditGetFixesResponse;
				const assists = results[1] as as.EditGetAssistsResponse;

				const allActions = new Array<CodeAction>();
				for (const errorFix of fixes.fixes)
					allActions.push(...errorFix.fixes.map((fix) => this.convertResult(document, fix, CodeActionKind.QuickFix, errorFix.error)));
				allActions.push(...assists.assists.map((assist) => this.convertResult(document, assist, CodeActionKind.Refactor)));

				console.log(JSON.stringify(allActions));
				resolve(allActions);
			}, (e) => { logError(e); reject(); });
		});
	}

	private convertResult(document: TextDocument, change: as.SourceChange, kind: CodeActionKind, error?: as.AnalysisError): CodeAction {
		const title = change.message;
		const diagnostics = error ? [DartDiagnosticProvider.createDiagnostic(error)] : undefined;
		return {
			command: {
				arguments: [document, change],
				command: "_dart.applySourceChange",
				title,
			},
			diagnostics,
			kind,
			title,
		};
	}
}
