import * as vs from "vscode";
import { OpenFileTracker } from "../analysis/open_file_tracker";
import { TestOutlineInfo, TestOutlineVisitor } from "../utils/vscode/outline";

export const CURSOR_IS_IN_TEST = "dart-code:cursorIsInTest";
export let cursorIsInTest = false; // HACK: Used for testing since we can't read contexts?

export class TestCommands implements vs.Disposable {
	private disposables: vs.Disposable[] = [];

	constructor() {
		this.disposables.push(
			vs.commands.registerCommand("dart.runTestAtCursor", () => this.runTestAtCursor(false), this),
			vs.commands.registerCommand("dart.debugTestAtCursor", () => this.runTestAtCursor(true), this),
			vs.window.onDidChangeTextEditorSelection((e) => this.updateContext(e)),
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

	private updateContext(e: vs.TextEditorSelectionChangeEvent): void {
		const isValidTestLocation = !!(e.textEditor && e.selections && e.selections.length === 1 && this.testForCursor(e.textEditor));
		vs.commands.executeCommand("setContext", CURSOR_IS_IN_TEST, isValidTestLocation);
		cursorIsInTest = isValidTestLocation;
	}

	private testForCursor(editor: vs.TextEditor): TestOutlineInfo | undefined {
		const document = editor.document;
		const outline = OpenFileTracker.getOutlineFor(document.uri);
		if (!outline || !outline.children || !outline.children.length)
			return;

		// We should only allow running for projects we know can actually handle `pub run` (for ex. the
		// SDK codebase cannot, and will therefore run all tests).
		if (!OpenFileTracker.supportsPubRunTest(document.uri))
			return;

		const visitor = new TestOutlineVisitor();
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
