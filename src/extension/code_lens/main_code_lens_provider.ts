import { isArray } from "util";
import { CancellationToken, CodeLens, CodeLensProvider, Event, EventEmitter, TextDocument, workspace } from "vscode";
import { IAmDisposable, Logger } from "../../shared/interfaces";
import { escapeRegExp } from "../../shared/utils";
import { fsPath } from "../../shared/utils/fs";
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

		const runConfigs: TemplatedLaunchConfig[] = workspace.getConfiguration("launch", document.uri).get<any[]>("configurations") || [];
		const fileType = isTestFile(fsPath(document.uri)) ? "test-file" : "file";
		const wantedTemplateTypes = [`run-${fileType}`, `debug-${fileType}`];

		// Loop through each launch config and add the relevant templates. Configs may be
		// added multiple times if they have multiple template types.
		const runFileTemplates: Array<{ name: string, template: string }> = [];
		for (const templateType of wantedTemplateTypes) {
			const relevantLaunchConfigs = runConfigs.filter((c) => c.type === "dart" && isTemplateOfType(c, templateType));
			for (const launchConfig of relevantLaunchConfigs) {
				runFileTemplates.push({
					...launchConfig,
					name: launchConfig.name || "${debugType}",
					template: templateType,
				});
			}
		}

		const mainMethod = outline.children?.find((o) => o.element.name === "main");
		if (!mainMethod)
			return;

		const debugTypeRegex = new RegExp(escapeRegExp("${debugType}"), "gi");
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
		].concat(runFileTemplates.map((t) => new CodeLens(
			toRange(document, mainMethod.offset, mainMethod.length),
			{
				arguments: [document.uri, t],
				command: t.template === `run-${fileType}` ? "dart.startWithoutDebugging" : "dart.startDebugging",
				title: t.name.replace(debugTypeRegex, t.template === `run-${fileType}` ? "Run" : "Debug"),
			},
		)));
	}

	public dispose(): any {
		this.disposables.forEach((d) => d.dispose());
	}
}

function isTemplateOfType(config: TemplatedLaunchConfig, templateType: string): boolean {
	return !!config.template && (
		(typeof config.template === "string" && config.template === templateType)
		|| (isArray(config.template) && config.template.indexOf(templateType) !== -1)
	);
}

interface TemplatedLaunchConfig {
	name?: string;
	type?: string;
	template?: string | string[];
}
