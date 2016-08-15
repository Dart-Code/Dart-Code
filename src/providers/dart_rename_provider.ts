"use strict";

import { window, workspace, RenameProvider, WorkspaceEdit, TextDocument, Position, CancellationToken, Uri, TextEdit, Range } from "vscode";
import { Analyzer } from "../analysis/analyzer";
import * as as from "../analysis/analysis_server_types";

export class DartRenameProvider implements RenameProvider {
	private analyzer: Analyzer;
	constructor(analyzer: Analyzer) {
		this.analyzer = analyzer;
	}

	provideRenameEdits(document: TextDocument, position: Position, newName: string, token: CancellationToken): Thenable<WorkspaceEdit> {
		return this.doRename(document, position, newName, token);
	}

	private doRename(document: TextDocument, position: Position, newName: string, token: CancellationToken): Thenable<WorkspaceEdit> {
		return new Promise<WorkspaceEdit>((resolve, reject) => {
			var wordRange = document.getWordRangeAtPosition(position);
			this.analyzer.editGetRefactoring({
				kind: "RENAME",
				file: document.fileName,
				offset: document.offsetAt(wordRange.start),
				length: wordRange.end.character - wordRange.start.character,
				validateOnly: false,
				options: {
					newName: newName
				}
			}).then(resp => {
				let workspaceEdit = new WorkspaceEdit();

				let hasError = this.handleProblem(
					resp.initialProblems
						.concat(resp.optionsProblems)
						.concat(resp.finalProblems)
				);

				if (hasError) {
					reject("");
					return;
				}

				let promises = [];
				resp.change.edits.forEach(changeEdit => {
					changeEdit.edits.forEach(fileEdit => {
						let uri = Uri.file(changeEdit.file);
						let promise = workspace.openTextDocument(uri)
						promises.push(promise);
						promise.then(document => {
							workspaceEdit.replace(
								uri,
								new Range(
									document.positionAt(fileEdit.offset),
									document.positionAt(fileEdit.offset + fileEdit.length)),
								fileEdit.replacement
							);
						});
					});
				});

				// Wait all openTextDocument to finish
				Promise.all(promises).then(() => {
					window.showInformationMessage(resp.change.message);
					resolve(workspaceEdit)
				});

			}, e => console.warn(e.message));
		});
	}

	private handleProblem(problems: as.RefactoringProblem[]): boolean {
		let hasError = false;
		problems.forEach(problem => {
			switch (problem.severity) {

				case "INFO":
					window.showInformationMessage(problem.message);
					break;

				case "WARNING":
					window.showWarningMessage(problem.message);
					break;

				default: // This can be ERROR or FATAL problems
					hasError = true;
					window.showErrorMessage(problem.message);
			}
		});
		return hasError;
	}
}