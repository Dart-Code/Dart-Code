import * as fs from "fs";
import * as path from "path";
import * as vs from "vscode";
import { noAction } from "../../shared/constants";
import { Logger } from "../../shared/interfaces";
import { escapeDartString, generateTestNameFromFileName } from "../../shared/utils";
import { fsPath, mkDirRecursive } from "../../shared/utils/fs";
import { TestOutlineInfo, TestOutlineVisitor } from "../../shared/utils/outline_das";
import { LspTestOutlineInfo, LspTestOutlineVisitor } from "../../shared/utils/outline_lsp";
import { createTestFileAction, defaultTestFileContents, getLaunchConfig } from "../../shared/utils/test";
import { WorkspaceContext } from "../../shared/workspace";
import { DasFileTracker } from "../analysis/file_tracker_das";
import { LspFileTracker } from "../analysis/file_tracker_lsp";
import { isDartDocument } from "../editors";
import { isTestFile } from "../utils";

const CURSOR_IS_IN_TEST = "dart-code:cursorIsInTest";
const CAN_JUMP_BETWEEN_TEST_IMPLEMENTATION = "dart-code:canGoToTestOrImplementationFile";
// HACK: Used for testing since we can't read contexts?
export let cursorIsInTest = false;
export let isInTestFileThatHasImplementation = false;
export let isInImplementationFileThatCanHaveTest = false;

abstract class TestCommands implements vs.Disposable {
	private disposables: vs.Disposable[] = [];

	constructor(protected readonly logger: Logger, protected readonly wsContext: WorkspaceContext) {
		this.disposables.push(
			vs.commands.registerCommand("dart.runTestAtCursor", () => this.runTestAtCursor(false), this),
			vs.commands.registerCommand("dart.goToTests", (resource: vs.Uri | undefined) => this.goToTestOrImplementationFile(resource), this),
			vs.commands.registerCommand("dart.goToTestOrImplementationFile", () => this.goToTestOrImplementationFile(), this),
			vs.commands.registerCommand("dart.debugTestAtCursor", () => this.runTestAtCursor(true), this),
			vs.window.onDidChangeTextEditorSelection((e) => this.updateSelectionContexts(e)),
			vs.window.onDidChangeActiveTextEditor((e) => this.updateEditorContexts(e)),
		);
		// Run for current open editor.
		this.updateEditorContexts(vs.window.activeTextEditor);

		this.disposables.push(vs.commands.registerCommand("_dart.startDebuggingTestFromOutline", (test: TestOutlineInfo, launchTemplate: any | undefined) => {
			vs.debug.startDebugging(
				vs.workspace.getWorkspaceFolder(vs.Uri.file(test.file)),
				getLaunchConfig(false, test.file, [test.fullName], test.isGroup, launchTemplate),
			);
		}));
		this.disposables.push(vs.commands.registerCommand("_dart.startWithoutDebuggingTestFromOutline", (test: TestOutlineInfo, launchTemplate: any | undefined) => {
			vs.debug.startDebugging(
				vs.workspace.getWorkspaceFolder(vs.Uri.file(test.file)),
				getLaunchConfig(true, test.file, [test.fullName], test.isGroup, launchTemplate),
			);
		}));
	}

	private async runTestAtCursor(debug: boolean): Promise<void> {
		const editor = vs.window.activeTextEditor;
		const test = editor && editor.selection && this.testForCursor(editor);

		if (test) {
			const command = debug
				? "_dart.startDebuggingTestFromOutline"
				: "_dart.startWithoutDebuggingTestFromOutline";
			vs.commands.executeCommand(command, test);
		} else {
			vs.window.showWarningMessage("There is no test at the current location.");
		}
	}

	private async goToTestOrImplementationFile(resource?: vs.Uri): Promise<void> {
		const doc = resource
			? await vs.workspace.openTextDocument(resource)
			: vs.window.activeTextEditor?.document;
		if (doc && isDartDocument(doc)) {
			const filePath = fsPath(doc.uri);
			const isTest = isTestFile(filePath);
			const otherFile = isTest
				? this.getImplementationFileForTest(filePath)
				: this.getTestFileForImplementation(filePath);

			if (!otherFile || (isTest && !fs.existsSync(otherFile)))
				return;

			let selectionOffset: number | undefined;
			let selectionLength: number | undefined;

			// Offer to create test files.
			if (!fs.existsSync(otherFile)) {
				if (isTest)
					return;

				const relativePath = vs.workspace.asRelativePath(otherFile, false);
				const yesAction = createTestFileAction(relativePath);
				const response = await vs.window.showInformationMessage(
					`Would you like to create a test file at ${relativePath}?`,
					yesAction,
					noAction,
				);

				if (response !== yesAction)
					return;

				mkDirRecursive(path.dirname(otherFile));
				const testFileInfo = defaultTestFileContents(this.wsContext.hasAnyFlutterProjects, escapeDartString(generateTestNameFromFileName(relativePath)));
				fs.writeFileSync(otherFile, testFileInfo.contents);

				selectionOffset = testFileInfo.selectionOffset;
				selectionLength = testFileInfo.selectionLength;
			}

			const document = await vs.workspace.openTextDocument(otherFile);
			const editor = await vs.window.showTextDocument(document);

			if (selectionOffset && selectionLength)
				editor.selection = new vs.Selection(document.positionAt(selectionOffset), document.positionAt(selectionOffset + selectionLength));
		}
	}

	private updateSelectionContexts(e: vs.TextEditorSelectionChangeEvent): void {
		const isValidTestLocation = !!(e.textEditor && e.selections && e.selections.length === 1 && this.testForCursor(e.textEditor));
		vs.commands.executeCommand("setContext", CURSOR_IS_IN_TEST, isValidTestLocation);
		cursorIsInTest = isValidTestLocation;
	}

	private updateEditorContexts(e: vs.TextEditor | undefined): void {
		isInTestFileThatHasImplementation = false;
		isInImplementationFileThatCanHaveTest = false;

		if (e && e.document && isDartDocument(e.document)) {
			const filePath = fsPath(e.document.uri);
			if (isTestFile(filePath)) {
				// Implementation files must exist.
				const implementationFilePath = this.getImplementationFileForTest(filePath);
				isInTestFileThatHasImplementation = !!implementationFilePath && fs.existsSync(implementationFilePath);
			} else {
				isInImplementationFileThatCanHaveTest = !!this.getTestFileForImplementation(filePath);
			}
		}

		vs.commands.executeCommand("setContext", CAN_JUMP_BETWEEN_TEST_IMPLEMENTATION, isInTestFileThatHasImplementation || isInImplementationFileThatCanHaveTest);
	}

	private getImplementationFileForTest(filePath: string) {
		const pathSegments = filePath.split(path.sep);

		// Replace test folder with lib.
		const testFolderIndex = pathSegments.lastIndexOf("test");
		if (testFolderIndex !== -1)
			pathSegments[testFolderIndex] = "lib";

		// Remove _test from the filename.
		pathSegments[pathSegments.length - 1] = pathSegments[pathSegments.length - 1].replace(/_test\.dart/, ".dart");

		return pathSegments.join(path.sep);
	}

	private getTestFileForImplementation(filePath: string) {
		const pathSegments = filePath.split(path.sep);

		// Replace lib folder with test.
		const libFolderIndex = pathSegments.lastIndexOf("lib");
		if (libFolderIndex === -1)
			return undefined;
		pathSegments[libFolderIndex] = "test";

		// Add _test to the filename.
		pathSegments[pathSegments.length - 1] = pathSegments[pathSegments.length - 1].replace(/\.dart/, "_test.dart");

		return pathSegments.join(path.sep);
	}

	protected abstract testForCursor(editor: vs.TextEditor): TestOutlineInfo | undefined;

	public dispose(): any {
		for (const command of this.disposables)
			command.dispose();
	}

}

export class DasTestCommands extends TestCommands {
	constructor(logger: Logger, wsContext: WorkspaceContext, private readonly fileTracker: DasFileTracker) {
		super(logger, wsContext);
	}

	protected testForCursor(editor: vs.TextEditor): TestOutlineInfo | undefined {
		const document = editor.document;
		const outline = this.fileTracker.getOutlineFor(document.uri);
		if (!outline || !outline.children || !outline.children.length)
			return;

		// We should only allow running for projects we know can actually handle `pub run` (for ex. the
		// SDK codebase cannot, and will therefore run all tests).
		if (!this.fileTracker.supportsPubRunTest(document.uri))
			return;

		const visitor = new TestOutlineVisitor(this.logger);
		visitor.visit(outline);
		return visitor.tests.reverse().find((t) => {
			let start = document.positionAt(t.offset);
			let end = document.positionAt(t.offset + t.length);

			// Widen the range to start/end of lines.
			start = document.lineAt(start.line).rangeIncludingLineBreak.start;
			end = document.lineAt(end.line).rangeIncludingLineBreak.end;

			return new vs.Range(start, end).contains(editor.selection);
		});
	}
}

export class LspTestCommands extends TestCommands {
	constructor(logger: Logger, wsContext: WorkspaceContext, private readonly fileTracker: LspFileTracker) {
		super(logger, wsContext);
	}

	protected testForCursor(editor: vs.TextEditor): LspTestOutlineInfo | undefined {
		const document = editor.document;
		const outline = this.fileTracker.getOutlineFor(document.uri);
		if (!outline || !outline.children || !outline.children.length)
			return;

		// We should only allow running for projects we know can actually handle `pub run` (for ex. the
		// SDK codebase cannot, and will therefore run all tests).
		if (!this.fileTracker.supportsPubRunTest(document.uri))
			return;

		const visitor = new LspTestOutlineVisitor(this.logger, fsPath(document.uri));
		visitor.visit(outline);
		return visitor.tests.reverse().find((t) => {
			let start = t.range.start;
			let end = t.range.end;

			// Widen the range to start/end of lines.
			start = document.lineAt(start.line).rangeIncludingLineBreak.start;
			end = document.lineAt(end.line).rangeIncludingLineBreak.end;

			const vsRange = new vs.Range(start.line,
				start.character,
				end.line,
				end.character,
			);
			return vsRange.contains(editor.selection);
		});
	}
}
