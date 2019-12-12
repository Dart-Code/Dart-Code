import * as fs from "fs";
import * as path from "path";
import * as vs from "vscode";
import { Logger } from "../../shared/interfaces";
import { TestOutlineInfo, TestOutlineVisitor } from "../../shared/utils/outline";
import { fsPath } from "../../shared/vscode/utils";
import { FileTracker } from "../analysis/open_file_tracker";
import { isDartDocument } from "../editors";
import { isTestFile } from "../utils";

const CURSOR_IS_IN_TEST = "dart-code:cursorIsInTest";
const CAN_JUMP_BETWEEN_TEST_IMPLEMENTATION = "dart-code:canGoToTestOrImplementationFile";
// HACK: Used for testing since we can't read contexts?
export let cursorIsInTest = false;
export let isInTestFile = false;
export let isInImplementationFile = false;

export class TestCommands implements vs.Disposable {
	private disposables: vs.Disposable[] = [];

	constructor(private readonly logger: Logger, private readonly fileTracker: FileTracker) {
		this.disposables.push(
			vs.commands.registerCommand("dart.runTestAtCursor", () => this.runTestAtCursor(false), this),
			vs.commands.registerCommand("dart.goToTestOrImplementationFile", () => this.goToTestOrImplementationFile(), this),
			vs.commands.registerCommand("dart.debugTestAtCursor", () => this.runTestAtCursor(true), this),
			vs.window.onDidChangeTextEditorSelection((e) => this.updateSelectionContexts(e)),
			vs.window.onDidChangeActiveTextEditor((e) => this.updateEditorContexts(e)),
		);
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

	private async goToTestOrImplementationFile(): Promise<void> {
		const e = vs.window.activeTextEditor;
		if (e && e.document && isDartDocument(e.document)) {
			const filePath = fsPath(e.document.uri);
			const otherFile =
				isTestFile(filePath)
					? this.getImplementationFileForTest(filePath)
					: this.getTestFileForImplementation(filePath);

			if (otherFile) {
				const document = await vs.workspace.openTextDocument(otherFile);
				await vs.window.showTextDocument(document);
			}
		}
	}

	private updateSelectionContexts(e: vs.TextEditorSelectionChangeEvent): void {
		const isValidTestLocation = !!(e.textEditor && e.selections && e.selections.length === 1 && this.testForCursor(e.textEditor));
		vs.commands.executeCommand("setContext", CURSOR_IS_IN_TEST, isValidTestLocation);
		cursorIsInTest = isValidTestLocation;
	}

	private updateEditorContexts(e: vs.TextEditor | undefined): void {
		isInTestFile = false;
		isInImplementationFile = false;

		if (e && e.document && isDartDocument(e.document)) {
			const filePath = fsPath(e.document.uri);
			if (isTestFile(filePath)) {
				isInTestFile = !!this.getImplementationFileForTest(filePath);
			} else {
				isInImplementationFile = !!this.getTestFileForImplementation(filePath);
			}
		}

		vs.commands.executeCommand("setContext", CAN_JUMP_BETWEEN_TEST_IMPLEMENTATION, isInTestFile || isInImplementationFile);
	}

	private getImplementationFileForTest(filePath: string) {
		const pathSegments = filePath.split(path.sep);

		// Replace test folder with lib.
		const testFolderIndex = pathSegments.lastIndexOf("test");
		if (testFolderIndex !== -1)
			pathSegments[testFolderIndex] = "lib";

		// Remove _test from the filename.
		pathSegments[pathSegments.length - 1] = pathSegments[pathSegments.length - 1].replace(/_test\.dart/, ".dart");

		// Only return if the file exists.
		const implementationFilePath = pathSegments.join(path.sep);
		return fs.existsSync(implementationFilePath)
			? implementationFilePath
			: undefined;
	}

	private getTestFileForImplementation(filePath: string) {
		const pathSegments = filePath.split(path.sep);

		// Replace lib folder with test.
		const libFolderIndex = pathSegments.lastIndexOf("lib");
		if (libFolderIndex !== -1)
			pathSegments[libFolderIndex] = "test";

		// Add _test to the filename.
		pathSegments[pathSegments.length - 1] = pathSegments[pathSegments.length - 1].replace(/\.dart/, "_test.dart");

		// Only return if the file exists.
		const testFilePath = pathSegments.join(path.sep);
		return fs.existsSync(testFilePath)
			? testFilePath
			: undefined;
	}

	private testForCursor(editor: vs.TextEditor): TestOutlineInfo | undefined {
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
			const start = document.positionAt(t.offset);
			const end = document.positionAt(t.offset + t.length);
			return new vs.Range(start, end).contains(editor.selection);
		});
	}

	public dispose(): any {
		for (const command of this.disposables)
			command.dispose();
	}

}
