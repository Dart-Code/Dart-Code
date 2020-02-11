import { CancellationToken, CodeLens, CodeLensProvider, Event, EventEmitter, TextDocument, workspace } from "vscode";
import { IAmDisposable, Logger } from "../../shared/interfaces";
import { flatMap } from "../../shared/utils";
import { fsPath } from "../../shared/utils/fs";
import { LspTestOutlineVisitor } from "../../shared/utils/outline_lsp";
import { lspToRange } from "../../shared/vscode/utils";
import { LspAnalyzer } from "../analysis/analyzer_lsp";

export class LspTestCodeLensProvider implements CodeLensProvider, IAmDisposable {
	private disposables: IAmDisposable[] = [];
	private onDidChangeCodeLensesEmitter: EventEmitter<void> = new EventEmitter<void>();
	public readonly onDidChangeCodeLenses: Event<void> = this.onDidChangeCodeLensesEmitter.event;

	constructor(private readonly logger: Logger, private readonly analyzer: LspAnalyzer) {
		this.disposables.push(this.analyzer.fileTracker.onOutline.listen((_) => {
			this.onDidChangeCodeLensesEmitter.fire();
		}));
	}

	public provideCodeLenses(document: TextDocument, token: CancellationToken): CodeLens[] | undefined {
		// This method has to be FAST because it affects layout of the document (adds extra lines) so
		// we don't already have an outline, we won't wait for one. A new outline arriving will trigger a
		// re-request anyway.
		const outline = this.analyzer.fileTracker.getOutlineFor(document.uri);
		if (!outline || !outline.children || !outline.children.length)
			return;

		// We should only show the CodeLens for projects we know can actually handle `pub run` (for ex. the
		// SDK codebase cannot, and will therefore run all tests when you click them).
		if (!this.analyzer.fileTracker.supportsPubRunTest(document.uri))
			return;

		const runConfigs = workspace.getConfiguration("launch", document.uri).get<any[]>("configurations") || [];
		const runTestTemplates = runConfigs.filter((c) => c && c.type === "dart" && c.template && (c.template === "run-test" || c.template === "debug-test"));

		const visitor = new LspTestOutlineVisitor(this.logger, fsPath(document.uri));
		visitor.visit(outline);
		return flatMap(
			visitor.tests
				.filter((test) => test.range)
				.map((test) => {
					return [
						new CodeLens(
							lspToRange(test.range),
							{
								arguments: [test],
								command: "_dart.startWithoutDebuggingTestFromOutline",
								title: "Run",
							},
						),
						new CodeLens(
							lspToRange(test.range),
							{
								arguments: [test],
								command: "_dart.startDebuggingTestFromOutline",
								title: "Debug",
							},
						),
					].concat(runTestTemplates.map((t) => new CodeLens(
						lspToRange(test.range),
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
