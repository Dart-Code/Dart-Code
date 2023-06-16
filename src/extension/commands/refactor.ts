import * as fs from "fs";
import * as path from "path";
import * as vs from "vscode";
import * as as from "../../shared/analysis_server_types";
import { REFACTOR_ANYWAY, REFACTOR_FAILED_DOC_MODIFIED } from "../../shared/constants";
import { Logger } from "../../shared/interfaces";
import { flatMap } from "../../shared/utils";
import { unique } from "../../shared/utils/array";
import { fsPath } from "../../shared/utils/fs";
import { resolvedPromise } from "../../shared/utils/promises";
import { DasAnalyzerClient } from "../analysis/analyzer_das";
import { config } from "../config";
import { hasOverlappingEdits } from "./edit_das";

const refactorOptions: { [key: string]: (feedback?: as.RefactoringFeedback) => as.RefactoringOptions | Promise<as.RefactoringOptions> } = {
	EXTRACT_LOCAL_VARIABLE: getExtractLocalVariableArgs,
	EXTRACT_METHOD: getExtractMethodArgs,
	EXTRACT_WIDGET: getExtractWidgetArgs,
};

export class RefactorCommands implements vs.Disposable {
	private subscriptions: vs.Disposable[] = [];

	constructor(private readonly logger: Logger, private readonly context: vs.ExtensionContext, private readonly analyzer: DasAnalyzerClient) {
		this.subscriptions.push(
			vs.commands.registerCommand("_dart.performRefactor", this.performRefactor, this),
		);
		if (analyzer.capabilities.supportsMoveFile && config.updateImportsOnRename)
			this.subscriptions.push(vs.workspace.onWillRenameFiles((e) => this.onWillRenameFiles(e)));
	}

	private async performRefactor(document: vs.TextDocument, range: vs.Range, refactorKind: as.RefactoringKind): Promise<void> {
		// Ensure the document is still valid.
		if (!document || document.isClosed)
			return;

		const originalDocumentVersion = document.version;

		// Validate that there are no problems if we execute this refactor.
		const validationResult = await this.getRefactor(document, refactorKind, range, true);
		if (this.shouldAbortRefactor(validationResult))
			return;

		// Request the options from the user if required.
		let options;
		if (refactorOptions[refactorKind]) {
			options = await refactorOptions[refactorKind](validationResult.feedback);
			if (!options)
				return;
		}

		// Send the request for the refactor edits and prompt to apply if required.
		const editResult = await this.getRefactor(document, refactorKind, range, false, options);
		const applyEdits = await this.shouldApplyEdits(editResult, document, originalDocumentVersion);

		if (applyEdits)
			await vs.commands.executeCommand("_dart.applySourceChange", document, editResult.change);
	}

	private async getRefactor(
		document: vs.TextDocument,
		refactorKind: as.RefactoringKind,
		range: vs.Range,
		validateOnly: boolean,
		options?: as.RefactoringOptions): Promise<as.EditGetRefactoringResponse> {

		let remainingTries = 3;
		while (true) {
			try {
				remainingTries--;
				// await is important for the catch!
				return await this.analyzer.editGetRefactoring({
					file: fsPath(document.uri),
					kind: refactorKind,
					length: document.offsetAt(range.end) - document.offsetAt(range.start),
					offset: document.offsetAt(range.start),
					options,
					validateOnly,
				});
			} catch (e: any) {
				this.logger.error(e);
				if (remainingTries <= 0 || e.code !== "REFACTORING_REQUEST_CANCELLED")
					throw e;
				else
					this.logger.info(`getRefactor failed, will try ${remainingTries} more times...`);
			}
		}
	}

	private shouldAbortRefactor(validationResult: as.EditGetRefactoringResponse) {
		const validationProblems = validationResult.initialProblems
			.concat(validationResult.optionsProblems)
			.concat(validationResult.finalProblems)
			.filter((e) => e.severity === "FATAL");

		if (validationProblems.length) {
			void vs.window.showErrorMessage(validationProblems[0].message);
			return true;
		}
		return false;
	}

	private async shouldApplyEdits(editResult: as.EditGetRefactoringResponse, document?: vs.TextDocument, originalDocumentVersion?: number) {
		const allProblems = editResult.initialProblems
			.concat(editResult.optionsProblems)
			.concat(editResult.finalProblems);

		const editFatals = allProblems.filter((e) => e.severity === "FATAL");
		const editWarnings = allProblems.filter((e) => e.severity === "ERROR" || e.severity === "WARNING");
		const hasErrors = !!allProblems.find((e) => e.severity === "ERROR");

		// Fatal errors can never be applied, just tell the user and quit.
		if (editFatals.length) {
			void vs.window.showErrorMessage(unique(editFatals.map((e) => e.message)).join("\n\n") + "\n\nYour refactor was not applied.");
			return false;
		}

		// If we somehow got here with no change, we also cannot apply them.
		if (!editResult.change)
			return false;

		let applyEdits = true;

		// If we have warnings/errors, the user can decide whether to go ahead.
		if (editWarnings.length) {
			const show = hasErrors ? vs.window.showErrorMessage : vs.window.showWarningMessage;
			applyEdits = (REFACTOR_ANYWAY === await show(unique(editWarnings.map((w) => w.message)).join("\n\n"), REFACTOR_ANYWAY));
		}

		// If we're trying to apply changes but the document is modified, we have to quit.
		if (applyEdits && document && document.version !== originalDocumentVersion) {
			void vs.window.showErrorMessage(REFACTOR_FAILED_DOC_MODIFIED);
			return false;
		}

		return applyEdits;
	}

	private isProcessingMoveEvent = false;
	private onWillRenameFiles(e: vs.FileWillRenameEvent) {
		// TODO: VS Code always calls this once-per-file, concurrently for multiple files moved at once
		// which currently results in REFACTOR_CANCELLED for all but the first since the server doesn't
		// support multiple refactors at the same time. Running them sequentially fixes this, however it
		// hits an issue in VS Code (https://github.com/microsoft/vscode/issues/98309) so for now, we will
		// only process a single event at a time.
		if (this.isProcessingMoveEvent) {
			this.logger.info(`Skipping rename event for some files because another is in progress`);
			return;
		}
		try {
			const filesToRename =
				flatMap(e.files, (f) => this.getResourcesToRename({ oldPath: fsPath(f.oldUri), newPath: fsPath(f.newUri) }))
					// Renames are only supported for Dart files, so filter out anything else to avoid producing an edit that will
					// trigger VS Code to show the rename dialog.
					.filter((f) => path.extname(f.oldPath).toLowerCase() === ".dart");

			if (filesToRename.length === 0)
				return;

			this.isProcessingMoveEvent = true;
			const edits = this.getRenameEdits(filesToRename);
			e.waitUntil(edits.finally(() => this.isProcessingMoveEvent = false));
		} catch (e) {
			this.isProcessingMoveEvent = false;
		}
	}

	/// Server only supports one refactoring at a time, so we need to ensure we
	/// wait for any previous one to finish before sending this.
	private inProgressRefactor: Promise<any> = resolvedPromise;
	private async runSequentially<T>(func: () => Promise<T>): Promise<T> {
		this.inProgressRefactor = this.inProgressRefactor.then(() => func());
		return this.inProgressRefactor;
	}

	private async getRenameEdits(filesToRename: Array<{ oldPath: string, newPath: string }>): Promise<vs.WorkspaceEdit | undefined> {
		const changes = new vs.WorkspaceEdit();

		for (const file of filesToRename) {
			const editResult = await this.runSequentially(() => this.analyzer.editGetRefactoring({
				file: file.oldPath,
				kind: "MOVE_FILE",
				length: 0, // Not used for MOVE_FILE
				offset: 0, // Not used for MOVE_FILE
				options: { newFile: file.newPath },
				validateOnly: false,
			}));

			if (!editResult.change)
				continue;

			const applyEdits = await this.shouldApplyEdits(editResult);
			if (!applyEdits)
				continue;

			if (hasOverlappingEdits(editResult.change)) {
				void vs.window.showErrorMessage("Unable to update references; edits contain ambigious positions.");
				this.logger.error(`Unable to apply MOVE_FILE edits due to ambigious edits:\n\n${JSON.stringify(editResult.change, undefined, 4)}`);
				return;
			}

			for (const edit of editResult.change.edits) {
				for (const e of edit.edits) {
					const uri = vs.Uri.file(edit.file);
					const document = await vs.workspace.openTextDocument(uri);
					changes.replace(
						vs.Uri.file(edit.file),
						new vs.Range(
							document.positionAt(e.offset),
							document.positionAt(e.offset + e.length),
						),
						e.replacement,
					);
				}
			}
		}

		if (changes.size === 0)
			return;

		return changes;
	}

	private getResourcesToRename(rename: { oldPath: string, newPath: string }): Array<{ oldPath: string, newPath: string }> {
		const filesToRename: Array<{ oldPath: string, newPath: string }> = [];
		if (fs.statSync(rename.oldPath).isFile()) {
			// TODO: if (isAnalyzableAndInWorkspace(rename.oldPath))
			filesToRename.push(rename);
		}
		return filesToRename;
	}

	public dispose(): any {
		for (const command of this.subscriptions)
			command.dispose();
	}
}

async function getExtractLocalVariableArgs(f?: as.RefactoringFeedback): Promise<as.RefactoringOptions | undefined> {
	const feedback = f as as.ExtractLocalVariableFeedback | undefined;
	const proposedName = feedback && feedback.names && feedback.names.length ? feedback.names[0] : "x";
	return { name: proposedName, extractAll: false };
}

async function getExtractMethodArgs(f?: as.RefactoringFeedback): Promise<as.RefactoringOptions | undefined> {
	const feedback = f as as.ExtractMethodFeedback | undefined;
	const suggestedName = feedback && feedback.names && feedback.names.length ? feedback.names[0] : undefined;
	const name = await vs.window.showInputBox({ prompt: "Enter a name for the method", value: suggestedName });

	if (!name)
		return;

	return {
		createGetter: false,
		extractAll: false,
		name,
		parameters: feedback && feedback.parameters,
		returnType: feedback && feedback.returnType,
	};
}

async function getExtractWidgetArgs(f?: as.RefactoringFeedback): Promise<as.RefactoringOptions | undefined> {
	const name = await vs.window.showInputBox({ prompt: "Enter a name for the widget" });

	return name ? { name } : undefined;
}
