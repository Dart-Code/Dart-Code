import { CancellationToken, CodeLens, CodeLensProvider, commands, debug, Event, EventEmitter, TextDocument, Uri, workspace } from "vscode";
import { IAmDisposable, Logger } from "../../shared/interfaces";
import { flatMap } from "../../shared/utils";
import { TestOutlineInfo, TestOutlineVisitor } from "../../shared/utils/outline";
import { getLaunchConfig } from "../../shared/utils/test";
import { toRange } from "../../shared/vscode/utils";
import { DasAnalyzer } from "../analysis/analyzer_das";

export class TestCodeLensProvider implements CodeLensProvider, IAmDisposable {
	private disposables: IAmDisposable[] = [];
	private onDidChangeCodeLensesEmitter: EventEmitter<void> = new EventEmitter<void>();
	public readonly onDidChangeCodeLenses: Event<void> = this.onDidChangeCodeLensesEmitter.event;

	constructor(private readonly logger: Logger, private readonly analyzer: DasAnalyzer) {
		this.disposables.push(this.analyzer.client.registerForAnalysisOutline((n) => {
			this.onDidChangeCodeLensesEmitter.fire();
		}));

		this.disposables.push(commands.registerCommand("_dart.startDebuggingTestFromOutline", (test: TestOutlineInfo, launchTemplate: any | undefined) => {
			debug.startDebugging(
				workspace.getWorkspaceFolder(Uri.file(test.file)),
				getLaunchConfig(false, test.file, test.fullName, test.isGroup, launchTemplate),
			);
		}));
		this.disposables.push(commands.registerCommand("_dart.startWithoutDebuggingTestFromOutline", (test: TestOutlineInfo, launchTemplate: any | undefined) => {
			debug.startDebugging(
				workspace.getWorkspaceFolder(Uri.file(test.file)),
				getLaunchConfig(true, test.file, test.fullName, test.isGroup, launchTemplate),
			);
		}));
	}

	public provideCodeLenses(document: TextDocument, token: CancellationToken): CodeLens[] | undefined {
		// This method has to be FAST because it affects layout of the document (adds extra lines) so
		// we don't already have an outline, we won't wait for one. A new outline arriving will trigger a
		// re-request anyway.
		const outline = this.analyzer.fileTracker.getOutlineFor(document.uri);
		if (!outline || !outline.children || !outline.children.length)
			return;

		// We should only show the Code Lens for projects we know can actually handle `pub run` (for ex. the
		// SDK codebase cannot, and will therefore run all tests when you click them).
		if (!this.analyzer.fileTracker.supportsPubRunTest(document.uri))
			return;

		const runConfigs = workspace.getConfiguration("launch", document.uri).get<any[]>("configurations") || [];
		const runTestTemplates = runConfigs.filter((c) => c && c.type === "dart" && c.template && (c.template === "run-test" || c.template === "debug-test"));

		const visitor = new TestOutlineVisitor(this.logger);
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
					].concat(runTestTemplates.map((t) => new CodeLens(
						toRange(document, test.offset, test.length),
						{
							arguments: [test, t],
							command: t.template === "run-test" ? "_dart.startWithoutDebuggingTestFromOutline" : "_dart.startDebuggingTestFromOutline",
							title: t.name,
						},
					)));
				}),
			(x) => x,
		);
	}

	public dispose(): any {
		this.disposables.forEach((d) => d.dispose());
	}
}
