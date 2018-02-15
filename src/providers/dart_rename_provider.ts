"use strict";

import { window, workspace, RenameProvider, OutputChannel, WorkspaceEdit, TextDocument, Position, CancellationToken, Uri, TextEdit, Range } from "vscode";
import { Analyzer } from "../analysis/analyzer";
import * as as from "../analysis/analysis_server_types";
import * as channels from "../commands/channels";
import * as utils from "../utils";

export class DartRenameProvider implements RenameProvider {
	private analyzer: Analyzer;
	constructor(analyzer: Analyzer) {
		this.analyzer = analyzer;
	}

	public provideRenameEdits(document: TextDocument, position: Position, newName: string, token: CancellationToken): Thenable<WorkspaceEdit> {
		return this.doRename(document, position, newName, token);
	}

	private doRename(document: TextDocument, position: Position, newName: string, token: CancellationToken): Thenable<WorkspaceEdit> {
		return new Promise<WorkspaceEdit>((resolve, reject) => {
			const wordRange = document.getWordRangeAtPosition(position);
			const outputChannel = channels.getChannel("Refactorings");
			outputChannel.appendLine("");

			this.analyzer.editGetRefactoring({
				file: document.fileName,
				kind: "RENAME",
				length: wordRange.end.character - wordRange.start.character,
				offset: document.offsetAt(wordRange.start),
				options: {
					newName,
				},
				validateOnly: false,
			}).then((resp) => {
				const workspaceEdit = new WorkspaceEdit();

				// Check that the thing we're refactoring macthes up with what the AS says the oldName is. This
				// allows us to abort (even though it's a bit late) if it seems like we're doing something unexpected.
				// See https://github.com/Dart-Code/Dart-Code/issues/144
				if (resp.feedback) {
					const expectedOldName = document.getText(wordRange);
					const actualOldName = (resp.feedback as as.RenameFeedback).oldName; // TODO: Does the API spec have enough for us to make these generics?
					if (actualOldName != null && actualOldName !== expectedOldName) {
						window.showErrorMessage("This type of rename is not yet supported.");
						outputChannel.appendLine(`[ERROR] Rename aborting due to rename mismatch (expected: ${expectedOldName}, got: ${actualOldName}). This rename will be supported in a future version.`);
						reject("");
						return;
					}
				}

				if (resp.change && resp.change.message)
					outputChannel.appendLine(`[INFO] ${resp.change.message}…`);

				const hasError = this.handleProblem(
					resp.initialProblems
						.concat(resp.optionsProblems)
						.concat(resp.finalProblems),
					outputChannel,
				);

				if (hasError) {
					outputChannel.appendLine("[INFO] Rename aborted.");
					reject("");
					return;
				}

				const promises: Array<Thenable<TextDocument>> = [];
				resp.change.edits.forEach((changeEdit) => {
					changeEdit.edits.forEach((fileEdit) => {
						const uri = Uri.file(changeEdit.file);
						const promise = workspace.openTextDocument(uri);
						promises.push(promise);
						promise.then((document) => {
							workspaceEdit.replace(
								uri,
								new Range(
									document.positionAt(fileEdit.offset),
									document.positionAt(fileEdit.offset + fileEdit.length)),
								fileEdit.replacement,
							);
						});
					});
				});

				// Wait all openTextDocument to finish
				Promise.all(promises).then(() => {
					outputChannel.appendLine("[INFO] Rename successful.");
					resolve(workspaceEdit);
				});

			}, (e) => console.warn(e.message));
		});
	}

	private handleProblem(problems: as.RefactoringProblem[], outputChannel: OutputChannel): boolean {
		// Log all in output channel.
		problems.forEach((problem) => outputChannel.appendLine(`[${problem.severity}] ${problem.message}`));

		const errors = problems
			.filter((p) => p.severity !== "INFO" && p.severity !== "WARNING")
			.sort((p1, p2) => p2.severity.localeCompare(p1.severity));

		if (errors.length === 0)
			return false;

		// Popups just the first error.
		window.showErrorMessage(errors[0].message);

		return true;
	}
}
