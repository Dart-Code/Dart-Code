import * as vs from "vscode";
import { fsPath } from "../../shared/vscode/utils";
import * as as from "../analysis/analysis_server_types";
import { Analyzer } from "../analysis/analyzer";
import { unique } from "../utils";
import { logError, logInfo } from "../utils/log";

export const REFACTOR_FAILED_DOC_MODIFIED = "This refactor cannot be applied because the document has changed.";
export const REFACTOR_ANYWAY = "Refactor Anyway";

const refactorOptions: { [key: string]: (feedback?: as.RefactoringFeedback) => as.RefactoringOptions } = {
	EXTRACT_LOCAL_VARIABLE: getExtractLocalVariableArgs,
	EXTRACT_METHOD: getExtractMethodArgs,
	EXTRACT_WIDGET: getExtractWidgetArgs,
};

export class RefactorCommands implements vs.Disposable {
	private commands: vs.Disposable[] = [];

	constructor(private readonly context: vs.ExtensionContext, private readonly analyzer: Analyzer) {
		this.commands.push(
			vs.commands.registerCommand("_dart.performRefactor", this.performRefactor, this),
		);
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
		options?: as.RefactoringOptions)
		: Promise<as.EditGetRefactoringResponse> {

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
			} catch (e) {
				logError(e);
				if (remainingTries <= 0 || e.code !== "REFACTORING_REQUEST_CANCELLED")
					throw e;
				else
					logInfo(`getRefactor failed, will try ${remainingTries} more times...`);
			}
		}
	}

	private shouldAbortRefactor(validationResult: as.EditGetRefactoringResponse) {
		const validationProblems = validationResult.initialProblems
			.concat(validationResult.optionsProblems)
			.concat(validationResult.finalProblems)
			.filter((e) => e.severity === "FATAL");

		if (validationProblems.length) {
			vs.window.showErrorMessage(validationProblems[0].message);
			return true;
		}
		return false;
	}

	private async shouldApplyEdits(editResult: as.EditGetRefactoringResponse, document: vs.TextDocument, originalDocumentVersion: number) {
		const allProblems = editResult.initialProblems
			.concat(editResult.optionsProblems)
			.concat(editResult.finalProblems);

		const editFatals = allProblems.filter((e) => e.severity === "FATAL");
		const editWarnings = allProblems.filter((e) => e.severity === "ERROR" || e.severity === "WARNING");
		const hasErrors = !!allProblems.find((e) => e.severity === "ERROR");

		// Fatal errors can never be applied, just tell the user and quit.
		if (editFatals.length) {
			vs.window.showErrorMessage(unique(editFatals.map((e) => e.message)).join("\n\n") + "\n\nYour refactor was not applied.");
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
		if (applyEdits && document.version !== originalDocumentVersion) {
			vs.window.showErrorMessage(REFACTOR_FAILED_DOC_MODIFIED);
			return false;
		}

		return applyEdits;
	}

	public dispose(): any {
		for (const command of this.commands)
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
