import { CancellationToken, CodeLens, CodeLensProvider, commands, debug, Event, EventEmitter, TextDocument, Uri, workspace } from "vscode";
import { Analyzer } from "../analysis/analyzer";
import { OpenFileTracker } from "../analysis/open_file_tracker";
import { flatMap, IAmDisposable } from "../debug/utils";
import { toRange } from "../utils";
import { getLaunchConfig } from "../utils/test";
import { TestOutlineInfo, TestOutlineVisitor } from "../utils/vscode/outline";

export class TestCodeLensProvider implements CodeLensProvider, IAmDisposable {
	private disposables: IAmDisposable[] = [];
	private onDidChangeCodeLensesEmitter: EventEmitter<void> = new EventEmitter<void>();
	public readonly onDidChangeCodeLenses: Event<void> = this.onDidChangeCodeLensesEmitter.event;

	constructor(public readonly analyzer: Analyzer) {
		this.disposables.push(this.analyzer.registerForAnalysisOutline((n) => {
			this.onDidChangeCodeLensesEmitter.fire();
		}));

		this.disposables.push(commands.registerCommand("_dart.startDebuggingTestFromOutline", (test: TestOutlineInfo) => {
			debug.startDebugging(
				workspace.getWorkspaceFolder(Uri.file(test.file)),
				getLaunchConfig(false, test.file, test.fullName, test.isGroup),
			);
		}));
		this.disposables.push(commands.registerCommand("_dart.startWithoutDebuggingTestFromOutline", (test: TestOutlineInfo) => {
			debug.startDebugging(
				workspace.getWorkspaceFolder(Uri.file(test.file)),
				getLaunchConfig(true, test.file, test.fullName, test.isGroup),
			);
		}));
	}

	public async provideCodeLenses(document: TextDocument, token: CancellationToken): Promise<CodeLens[] | undefined> {
		// This method has to be FAST because it affects layout of the document (adds extra lines) so
		// we don't already have an outline, we won't wait for one. A new outline arriving will trigger a
		// re-request anyway.
		const outline = OpenFileTracker.getOutlineFor(document.uri);
		if (!outline || !outline.children || !outline.children.length)
			return;

		// We should only show the Code Lens for projects we know can actually handle `pub run` (for ex. the
		// SDK codebase cannot, and will therefore run all tests when you click them).
		if (!OpenFileTracker.supportsPubRunTest(document.uri))
			return;

		const visitor = new TestOutlineVisitor();
		visitor.visit(outline);
		return flatMap(
			visitor.tests
				.filter((test) => test.offset && test.length)
				.map((test) => {
					return [
						new CodeLens(
							toRange(document, test.offset, test.length),
							{
								arguments: [test],
								command: "_dart.startWithoutDebuggingTestFromOutline",
								title: "Run",
							},
						),
						new CodeLens(
							toRange(document, test.offset, test.length),
							{
								arguments: [test],
								command: "_dart.startDebuggingTestFromOutline",
								title: "Debug",
							},
						),
					];
				}),
			(x) => x,
		);
	}

	public dispose(): any {
		this.disposables.forEach((d) => d.dispose());
	}
}
