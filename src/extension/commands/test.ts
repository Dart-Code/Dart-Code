import * as fs from "fs";
import * as path from "path";
import * as vs from "vscode";
import { Logger } from "../../shared/interfaces";
import { fsPath } from "../../shared/utils/fs";
import { TestOutlineInfo, TestOutlineVisitor } from "../../shared/utils/outline_das";
import { LspTestOutlineInfo, LspTestOutlineVisitor } from "../../shared/utils/outline_lsp";
import { getLaunchConfig } from "../../shared/utils/test";
import { DasFileTracker } from "../analysis/file_tracker_das";
import { LspFileTracker } from "../analysis/file_tracker_lsp";
import { isDartDocument } from "../editors";
import { isTestFile } from "../utils";

const CURSOR_IS_IN_TEST = "dart-code:cursorIsInTest";
const CAN_JUMP_BETWEEN_TEST_IMPLEMENTATION = "dart-code:canGoToTestOrImplementationFile";
// HACK: Used for testing since we can't read contexts?
export let cursorIsInTest = false;
export let isInTestFile = false;
export let isInImplementationFile = false;

abstract class TestCommands implements vs.Disposable {
	private disposables: vs.Disposable[] = [];

	constructor(protected readonly logger: Logger) {
		this.disposables.push(
			vs.commands.registerCommand("dart.runTestAtCursor", () => this.runTestAtCursor(false), this),
			vs.commands.registerCommand("dart.goToTestOrImplementationFile", () => this.goToTestOrImplementationFile(), this),
			vs.commands.registerCommand("dart.debugTestAtCursor", () => this.runTestAtCursor(true), this),
			vs.window.onDidChangeTextEditorSelection((e) => this.updateSelectionContexts(e)),
			vs.window.onDidChangeActiveTextEditor((e) => this.updateEditorContexts(e)),
		);

		this.disposables.push(vs.commands.registerCommand("_dart.startDebuggingTestFromOutline", (test: TestOutlineInfo, launchTemplate: any | undefined) => {
			vs.debug.startDebugging(
				vs.workspace.getWorkspaceFolder(vs.Uri.file(test.file)),
				getLaunchConfig(false, test.file, test.fullName, test.isGroup, launchTemplate),
			);
		}));
		this.disposables.push(vs.commands.registerCommand("_dart.startWithoutDebuggingTestFromOutline", (test: TestOutlineInfo, launchTemplate: any | undefined) => {
			vs.debug.startDebugging(
				vs.workspace.getWorkspaceFolder(vs.Uri.file(test.file)),
				getLaunchConfig(true, test.file, test.fullName, test.isGroup, launchTemplate),
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

	protected abstract testForCursor(editor: vs.TextEditor): TestOutlineInfo | undefined;

	public dispose(): any {
		for (const command of this.disposables)
			command.dispose();
	}

}

export class DasTestCommands extends TestCommands {
	constructor(logger: Logger, private readonly fileTracker: DasFileTracker) {
		super(logger);
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
			const start = document.positionAt(t.offset);
			const end = document.positionAt(t.offset + t.length);
			return new vs.Range(start, end).contains(editor.selection);
		});
	}
}

export class LspTestCommands extends TestCommands {
	constructor(logger: Logger, private readonly fileTracker: LspFileTracker) {
		super(logger);
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
			const vsRange = new vs.Range(t.range.start.line,
				t.range.start.character,
				t.range.end.line,
				t.range.end.character,
			);
			return vsRange.contains(editor.selection);
		});
	}
}
