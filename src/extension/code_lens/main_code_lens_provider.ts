import * as path from "path";
import { CancellationToken, CodeLens, CodeLensProvider, Event, EventEmitter, TextDocument } from "vscode";
import { Outline } from "../../shared/analysis/lsp/custom_protocol";
import { IAmDisposable, Logger } from "../../shared/interfaces";
import { disposeAll } from "../../shared/utils";
import { fsPath } from "../../shared/utils/fs";
import { getTemplatedLaunchConfigs } from "../../shared/vscode/debugger";
import { lspToPosition, lspToRange } from "../../shared/vscode/utils";
import { LspAnalyzer } from "../analysis/analyzer";
import { extensionApiModel } from "../api/extension_api";
import { isInsideFlutterProject, isTestFile } from "../utils";

export class MainCodeLensProvider implements CodeLensProvider, IAmDisposable {
	private disposables: IAmDisposable[] = [];
	private onDidChangeCodeLensesEmitter: EventEmitter<void> = new EventEmitter<void>();
	public readonly onDidChangeCodeLenses: Event<void> = this.onDidChangeCodeLensesEmitter.event;

	constructor(private readonly logger: Logger, private readonly analyzer: LspAnalyzer) {
		this.disposables.push(this.analyzer.fileTracker.onOutline(() => {
			this.onDidChangeCodeLensesEmitter.fire();
		}));
		this.disposables.push(extensionApiModel.codeLensSuppressions.onDidChange(() => this.onDidChangeCodeLensesEmitter.fire()));
	}

	public async provideCodeLenses(document: TextDocument, token: CancellationToken): Promise<CodeLens[] | undefined> {
		// Check if main code lenses are suppressed for this document
		const suppressions = extensionApiModel.codeLensSuppressions.getOverrides(document.uri);
		if (suppressions.main) {
			return undefined;
		}

		// Without version numbers, the best we have to tell if an outline is likely correct or stale is
		// if its length matches the document exactly.
		const filename = path.basename(fsPath(document.uri));
		const expectedLength = document.getText().length;
		const outline = await this.analyzer.fileTracker.waitForOutline(document, token);
		if (!outline)
			this.logger.warn(`Failed to get outline for ${filename}, so unable to provide main CodeLens`);
		else {
			const actualLength = document.offsetAt(lspToPosition(outline.range.end));
			if (actualLength !== expectedLength)
				this.logger.warn(`Outline for ${filename} has length ${actualLength} but expected ${actualLength}, so unable to provide main CodeLens`);
		}
		if (!outline?.children?.length)
			return;

		const fileType = isTestFile(fsPath(document.uri)) ? "test-file" : "file";
		const templates = getTemplatedLaunchConfigs(document.uri, fileType);
		const templatesHaveRun = !!templates.find((t) => t.name === "Run");
		const templatesHaveDebug = !!templates.find((t) => t.name === "Debug");
		const templatesHaveProfile = !!templates.find((t) => t.name === "Profile");

		const mainFunction = outline.children?.find((o) => o.element.name === "main");
		if (!mainFunction)
			return;

		const results: CodeLens[] = [];
		if (!templatesHaveRun)
			results.push(this.createCodeLens(document, mainFunction, "Run", false));
		if (!templatesHaveDebug)
			results.push(this.createCodeLens(document, mainFunction, "Debug", true));
		if (fileType === "file" && !templatesHaveProfile && isInsideFlutterProject(document.uri))
			results.push(this.createCodeLens(document, mainFunction, "Profile", false, { flutterMode: "profile", openDevTools: "performance" }));
		return results.concat(templates.map((t) => this.createCodeLens(document, mainFunction, t.name, !t.noDebug, t)));
	}

	private createCodeLens(document: TextDocument, mainFunction: Outline, name: string, debug: boolean, template?: Record<string, string>): CodeLens {
		return new CodeLens(
			lspToRange(mainFunction.codeRange),
			{
				arguments: [{ resource: document.uri, launchTemplate: template }],
				command: debug ? "dart.startDebugging" : "dart.startWithoutDebugging",
				title: name,
			}
		);
	}

	public dispose(): any {
		disposeAll(this.disposables);
	}
}
