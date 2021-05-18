import { CancellationToken, CodeLens, CodeLensProvider, Event, EventEmitter, TextDocument } from "vscode";
import { Outline } from "../../shared/analysis/lsp/custom_protocol";
import { IAmDisposable, Logger } from "../../shared/interfaces";
import { disposeAll } from "../../shared/utils";
import { fsPath } from "../../shared/utils/fs";
import { getTemplatedLaunchConfigs } from "../../shared/vscode/debugger";
import { lspToRange } from "../../shared/vscode/utils";
import { LspAnalyzer } from "../analysis/analyzer_lsp";
import { isTestFile } from "../utils";

export class LspMainCodeLensProvider implements CodeLensProvider, IAmDisposable {
	private disposables: IAmDisposable[] = [];
	private onDidChangeCodeLensesEmitter: EventEmitter<void> = new EventEmitter<void>();
	public readonly onDidChangeCodeLenses: Event<void> = this.onDidChangeCodeLensesEmitter.event;

	constructor(private readonly logger: Logger, private readonly analyzer: LspAnalyzer) {
		this.disposables.push(this.analyzer.fileTracker.onOutline.listen(() => {
			this.onDidChangeCodeLensesEmitter.fire();
		}));
	}

	public async provideCodeLenses(document: TextDocument, token: CancellationToken): Promise<CodeLens[] | undefined> {
		// Without version numbers, the best we have to tell if an outline is likely correct or stale is
		// if its length matches the document exactly.
		const expectedLength = document.getText().length;
		const outline = await this.analyzer.fileTracker.waitForOutlineWithLength(document, expectedLength, token);
		if (!outline || !outline.children || !outline.children.length)
			return;

		const fileType = isTestFile(fsPath(document.uri)) ? "test-file" : "file";
		const templates = getTemplatedLaunchConfigs(document, fileType);
		const templatesHaveRun = !!templates.find((t) => t.name === "Run");
		const templatesHaveDebug = !!templates.find((t) => t.name === "Debug");

		const mainFunction = outline.children?.find((o) => o.element.name === "main");
		if (!mainFunction)
			return;

		const results: CodeLens[] = [];
		if (!templatesHaveRun)
			results.push(this.createCodeLens(document, mainFunction, "Run", false));
		if (!templatesHaveDebug)
			results.push(this.createCodeLens(document, mainFunction, "Debug", true));
		return results.concat(templates.map((t) => this.createCodeLens(document, mainFunction, t.name, t.template.startsWith("debug"), t)));
	}

	private createCodeLens(document: TextDocument, mainFunction: Outline, name: string, debug: boolean, template?: { name: string }): CodeLens {
		return new CodeLens(
			lspToRange(mainFunction.range),
			{
				arguments: template ? [document.uri, template] : [document.uri],
				command: debug ? "dart.startDebugging" : "dart.startWithoutDebugging",
				title: name,
			}
		);
	}

	public dispose(): any {
		disposeAll(this.disposables);
	}
}
