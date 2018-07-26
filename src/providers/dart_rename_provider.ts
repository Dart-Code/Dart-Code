import { CancellationToken, OutputChannel, Position, Range, RenameProvider, TextDocument, Uri, workspace, WorkspaceEdit } from "vscode";
import * as as from "../analysis/analysis_server_types";
import { Analyzer } from "../analysis/analyzer";
import * as channels from "../commands/channels";
import { fsPath } from "../utils";

export class DartRenameProvider implements RenameProvider {
	constructor(private readonly analyzer: Analyzer) { }

	public provideRenameEdits(document: TextDocument, position: Position, newName: string, token: CancellationToken): Thenable<WorkspaceEdit> {
		return this.doRename(document, position, newName, token);
	}

	public prepareRename(document: TextDocument, position: Position, token: CancellationToken): Thenable<{ range: Range, placeholder: string }> {
		return this.getLocation(document, position);
	}

	private async doRename(document: TextDocument, position: Position, newName: string, token: CancellationToken): Promise<WorkspaceEdit> {
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
		const workspaceEdit = new WorkspaceEdit();

		if (resp.change && resp.change.message)
			outputChannel.appendLine(`[INFO] ${resp.change.message}…`);

		const hasError = this.handleProblem(
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
		outputChannel.appendLine("[INFO] Rename successful.");
		return workspaceEdit;
	}

	private handleProblem(problems: as.RefactoringProblem[], outputChannel: OutputChannel): boolean {
		// Log all in output channel.
		problems.forEach((problem) => outputChannel.appendLine(`[${problem.severity}] ${problem.message}`));

		const errors = problems
			.filter((p) => p.severity !== "INFO" && p.severity !== "WARNING")
			.sort((p1, p2) => p2.severity.localeCompare(p1.severity));

		if (errors.length === 0)
			return false;

		outputChannel.appendLine("[INFO] Rename aborted.");
		// Popups just the first error.
		throw errors[0].message;
	}

	private async getLocation(document: TextDocument, position: Position): Promise<{ range: Range, placeholder: string }> {
		const resp = await this.analyzer.editGetRefactoring({
			file: fsPath(document.uri),
			kind: "RENAME",
			length: 0,
			offset: document.offsetAt(position),
			validateOnly: true,
		});

		const feedback = (resp.feedback as as.RenameFeedback);

		// VS Code will reject the rename if our range doesn't span the position it gave us, but sometimes this isn't the case
		// such as `import "x" as y` when invoking rename on `import`, so we just it back the position is asked for.
		if (feedback) {
			return {
				placeholder: feedback.oldName,
				range: new Range(position, position),
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
