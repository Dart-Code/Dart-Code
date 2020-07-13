import { CancellationToken, CodeLens, CodeLensProvider, Event, EventEmitter, TextDocument } from "vscode";
import { IAmDisposable, Logger } from "../../shared/interfaces";
import { fsPath } from "../../shared/utils/fs";
import { getTemplatedLaunchConfigs } from "../../shared/vscode/debugger";
import { lspToPosition, lspToRange } from "../../shared/vscode/utils";
import { LspAnalyzer } from "../analysis/analyzer_lsp";
import { isTestFile } from "../utils";

export class LspMainCodeLensProvider implements CodeLensProvider, IAmDisposable {
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

		// Check that the outline we got looks like it still matches the document.
		// If the lengths are different, just bail without doing anything since
		// there have probably been new edits and we'll get a new outline soon.
		if (document.getText().length !== document.offsetAt(lspToPosition(outline.range.end)))
			return;

		const fileType = isTestFile(fsPath(document.uri)) ? "test-file" : "file";
		const templates = getTemplatedLaunchConfigs(document, fileType);

		const mainFunction = outline.children?.find((o) => o.element.name === "main");
		if (!mainFunction)
			return;

		return [
			new CodeLens(
				lspToRange(mainFunction.range),
				{
					arguments: [document.uri],
					command: "dart.startWithoutDebugging",
					title: "Run",
				},
			),
			new CodeLens(
				lspToRange(mainFunction.range),
				{
					arguments: [document.uri],
					command: "dart.startDebugging",
					title: "Debug",
				},
			),
		].concat(templates.map((t) => new CodeLens(
			lspToRange(mainFunction.range),
			{
				arguments: [document.uri, t],
				command: t.template === `run-${fileType}` ? "dart.startWithoutDebugging" : "dart.startDebugging",
				title: t.name,
			},
		)));
	}

	public dispose(): any {
		this.disposables.forEach((d) => d.dispose());
	}
}
