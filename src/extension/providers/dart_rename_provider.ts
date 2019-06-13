import { CancellationToken, OutputChannel, Position, Range, RenameProvider, TextDocument, Uri, workspace, WorkspaceEdit } from "vscode";
import * as as from "../../shared/analysis_server_types";
import { fsPath } from "../../shared/vscode/utils";
import { Analyzer } from "../analysis/analyzer";
import * as channels from "../commands/channels";
import { toRange } from "../utils";

export class DartRenameProvider implements RenameProvider {
	constructor(private readonly analyzer: Analyzer) { }

	public provideRenameEdits(document: TextDocument, position: Position, newName: string, token: CancellationToken): Thenable<WorkspaceEdit> {
		return this.doRename(document, position, newName, token);
	}

	public prepareRename(document: TextDocument, position: Position, token: CancellationToken): Thenable<{ range: Range, placeholder: string }> {
		return this.getLocation(document, position, token);
	}

	private async doRename(document: TextDocument, position: Position, newName: string, token: CancellationToken): Promise<WorkspaceEdit | undefined> {
		const outputChannel = channels.getChannel("Refactorings");
		outputChannel.appendLine("");

		const resp = await this.analyzer.editGetRefactoring({
			file: fsPath(document.uri),
			kind: "RENAME",
			length: 1,
			offset: document.offsetAt(position),
			options: {
				newName,
			},
			validateOnly: false,
		});

		if (token && token.isCancellationRequested) {
			outputChannel.appendLine("[INFO] Rename cancelled.");
			return;
		}

		const workspaceEdit = new WorkspaceEdit();

		if (resp.change && resp.change.message)
			outputChannel.appendLine(`[INFO] ${resp.change.message}…`);

		this.handleProblem(
			resp.initialProblems
				.concat(resp.optionsProblems)
				.concat(resp.finalProblems),
			outputChannel,
		);

		const promises: Array<Thenable<void>> = [];
		resp.change.edits.forEach((changeEdit) => {
			changeEdit.edits.forEach((fileEdit) => {
				const uri = Uri.file(changeEdit.file);
				const promise = workspace.openTextDocument(uri);
				promises.push(
					promise.then((document) =>
						workspaceEdit.replace(
							uri,
							new Range(
								document.positionAt(fileEdit.offset),
								document.positionAt(fileEdit.offset + fileEdit.length),
							),
							fileEdit.replacement,
						),
					),
				);
			});
		});

		// TODO: This class is inconsistent with other refactors (which are silent when they work, for ex).
		// We should review what we can extract share (though note that this method must return the edit whereas
		// the other refactors apply them).

		// Wait all openTextDocument to finish
		await Promise.all(promises);

		if (token && token.isCancellationRequested) {
			outputChannel.appendLine("[INFO] Rename cancelled.");
			return;
		}

		outputChannel.appendLine("[INFO] Rename successful.");
		return workspaceEdit;
	}

	private handleProblem(problems: as.RefactoringProblem[], outputChannel: OutputChannel): void {
		// Log all in output channel.
		problems.forEach((problem) => outputChannel.appendLine(`[${problem.severity}] ${problem.message}`));

		const errors = problems
			.filter((p) => p.severity !== "INFO" && p.severity !== "WARNING")
			.sort((p1, p2) => p2.severity.localeCompare(p1.severity));

		if (errors.length !== 0) {
			outputChannel.appendLine("[INFO] Rename aborted.");
			throw errors[0].message;
		}
	}

	private async getLocation(document: TextDocument, position: Position, token: CancellationToken): Promise<{ range: Range, placeholder: string } | undefined> {
		const resp = await this.analyzer.editGetRefactoring({
			file: fsPath(document.uri),
			kind: "RENAME",
			length: 0,
			offset: document.offsetAt(position),
			validateOnly: true,
		});

		if (token && token.isCancellationRequested)
			return;

		if (!resp.feedback)
			throw new Error("You cannot rename this element.");

		const feedback = (resp.feedback as as.RenameFeedback);

		// The dart server returns -1 when the old name doesn't exist (for ex. renaming an unprefixed import to add a prefix)
		// so we use a zero-character range at the requested position in this case.
		const range = feedback.offset === -1
			? new Range(position, position)
			: toRange(document, feedback.offset, feedback.length);

		if (feedback) {
			return {
				placeholder: feedback.oldName,
				range,
			};
		} else {
			const fatalProblems = resp.initialProblems
				.concat(resp.optionsProblems)
				.concat(resp.finalProblems)
				.filter((p) => p.severity === "FATAL");

			if (fatalProblems && fatalProblems.length) {
				throw new Error(fatalProblems[0].message);
			} else {
				throw new Error("This rename is not supported.");
			}
		}
	}
}
