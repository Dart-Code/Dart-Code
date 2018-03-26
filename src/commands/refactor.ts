import * as as from "../analysis/analysis_server_types";
import * as editors from "../editors";
import * as vs from "vscode";
import { Analyzer } from "../analysis/analyzer";
import { unique } from "../utils";

const refactorOptions: { [key: string]: (feedback: as.RefactoringFeedback) => as.RefactoringOptions } = {
	EXTRACT_METHOD: getExtractMethodArgs,
};

export class RefactorCommands implements vs.Disposable {
	private context: vs.ExtensionContext;
	private analyzer: Analyzer;
	private commands: vs.Disposable[] = [];

	constructor(context: vs.ExtensionContext, analyzer: Analyzer) {
		this.context = context;
		this.analyzer = analyzer;

		this.commands.push(
			vs.commands.registerCommand("_dart.performRefactor", this.performRefactor, this),
		);
	}

	private async performRefactor(document: vs.TextDocument, range: vs.Range, refactorKind: as.RefactoringKind) {
		// Ensure the document is still valid.
		if (!document || document.isClosed)
			return;

		const originalDocumentVersion = document.version;

		// Validate that there are no problems if we execute this refactor.
		const validationResult = await this.analyzer.editGetRefactoring({
			file: document.fileName,
			kind: refactorKind,
			length: document.offsetAt(range.end) - document.offsetAt(range.start),
			offset: document.offsetAt(range.start),
			validateOnly: true,
		});

		const validationProblems = validationResult.initialProblems
			.concat(validationResult.optionsProblems)
			.concat(validationResult.finalProblems);

		if (validationProblems.length) {
			vs.window.showErrorMessage(validationProblems[0].message);
			return;
		}

		// Request the options from the user.
		const options = await refactorOptions[refactorKind](validationResult.feedback);

		if (!options)
			return;

		// Send the request for the refactor edits.
		const editResult = await this.analyzer.editGetRefactoring({
			file: document.fileName,
			kind: refactorKind,
			length: document.offsetAt(range.end) - document.offsetAt(range.start),
			offset: document.offsetAt(range.start),
			options,
			validateOnly: false,
		});

		const editProblems = editResult.initialProblems
			.concat(editResult.optionsProblems)
			.concat(editResult.finalProblems);

		const editErrors = editProblems.filter((e) => e.severity === "FATAL" || e.severity === "ERROR");
		const editWarnings = editProblems.filter((e) => e.severity === "WARNING");

		let applyEdits = !!editResult.change;

		if (editErrors.length) {
			vs.window.showErrorMessage(unique(editErrors.map((e) => e.message)).join("\n\n") + "\n\nYour refactor was not applied.");
			applyEdits = false;
			return;
		} else if (editWarnings.length) {
			const doItAnyway = "Refactor Anyway";
			applyEdits = (doItAnyway === await vs.window.showWarningMessage(unique(editWarnings.map((w) => w.message)).join("\n\n"), doItAnyway));
		}

		if (document.version !== originalDocumentVersion) {
			vs.window.showErrorMessage("This refactor cannot be applied because the document has changed.");
			applyEdits = false;
		}

		if (applyEdits) {
			vs.commands.executeCommand("_dart.applySourceChange", document, editResult.change);
		}
	}

	public dispose(): any {
		for (const command of this.commands)
			command.dispose();
	}
}

async function getExtractMethodArgs(f: as.RefactoringFeedback): Promise<as.RefactoringOptions> {
	const feedback = f as as.ExtractMethodFeedback;
	const suggestedName = feedback.names && feedback.names.length ? feedback.names[0] : undefined;
	const name = await vs.window.showInputBox({ prompt: "Enter a name for the method", value: suggestedName });

	if (!name)
		return;

	return {
		createGetter: false,
		extractAll: false,
		name,
		parameters: feedback.parameters,
		returnType: feedback.returnType,
	};
}
