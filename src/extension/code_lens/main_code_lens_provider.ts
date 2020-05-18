import { CancellationToken, CodeLens, CodeLensProvider, Event, EventEmitter, TextDocument } from "vscode";
import { IAmDisposable, Logger } from "../../shared/interfaces";
import { fsPath } from "../../shared/utils/fs";
import { debugTypeTokenRegex, getTemplatedLaunchConfigs } from "../../shared/vscode/debugger";
import { toRange } from "../../shared/vscode/utils";
import { DasAnalyzer } from "../analysis/analyzer_das";
import { isTestFile } from "../utils";

export class MainCodeLensProvider implements CodeLensProvider, IAmDisposable {
	private disposables: IAmDisposable[] = [];
	private onDidChangeCodeLensesEmitter: EventEmitter<void> = new EventEmitter<void>();
	public readonly onDidChangeCodeLenses: Event<void> = this.onDidChangeCodeLensesEmitter.event;

	constructor(private readonly logger: Logger, private readonly analyzer: DasAnalyzer) {
		this.disposables.push(this.analyzer.client.registerForAnalysisOutline((n) => {
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

		const fileType = isTestFile(fsPath(document.uri)) ? "test-file" : "file";
		const templates = getTemplatedLaunchConfigs(document, fileType);

		const mainMethod = outline.children?.find((o) => o.element.name === "main");
		if (!mainMethod)
			return;

		return [
			new CodeLens(
				toRange(document, mainMethod.offset, mainMethod.length),
				{
					arguments: [document.uri],
					command: "dart.startWithoutDebugging",
					title: "Run",
				},
			),
			new CodeLens(
				toRange(document, mainMethod.offset, mainMethod.length),
				{
					arguments: [document.uri],
					command: "dart.startDebugging",
					title: "Debug",
				},
			),
		].concat(templates.map((t) => new CodeLens(
			toRange(document, mainMethod.offset, mainMethod.length),
			{
				arguments: [document.uri, t],
				command: t.template === `run-${fileType}` ? "dart.startWithoutDebugging" : "dart.startDebugging",
				title: t.name.replace(debugTypeTokenRegex, t.template === `run-${fileType}` ? "Run" : "Debug"),
			},
		)));
	}

	public dispose(): any {
		this.disposables.forEach((d) => d.dispose());
	}
}
