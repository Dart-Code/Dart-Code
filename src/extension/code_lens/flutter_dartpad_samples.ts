import * as path from "path";
import { CancellationToken, CodeLens, CodeLensProvider, commands, Event, EventEmitter, TextDocument } from "vscode";
import { FlutterSdks, IAmDisposable, Logger } from "../../shared/interfaces";
import { disposeAll } from "../../shared/utils";
import { fsPath } from "../../shared/utils/fs";
import { ClassOutlineVisitor } from "../../shared/utils/outline_das";
import { envUtils, toRange } from "../../shared/vscode/utils";
import { DasAnalyzer } from "../analysis/analyzer_das";

const dartPadSamplePattern = new RegExp("\\{@tool\\s+dartpad");

export class FlutterDartPadSamplesCodeLensProvider implements CodeLensProvider, IAmDisposable {
	private disposables: IAmDisposable[] = [];
	private onDidChangeCodeLensesEmitter: EventEmitter<void> = new EventEmitter<void>();
	public readonly onDidChangeCodeLenses: Event<void> = this.onDidChangeCodeLensesEmitter.event;
	private readonly flutterPackagesFolder: string;

	constructor(private readonly logger: Logger, private readonly analyzer: DasAnalyzer, private readonly sdks: FlutterSdks) {
		this.disposables.push(this.analyzer.client.registerForAnalysisOutline((n) => {
			this.onDidChangeCodeLensesEmitter.fire();
		}));

		this.disposables.push(commands.registerCommand("_dart.openDartPadSample", async (sample: DartPadSampleInfo) => {
			// Link down to first code snippet.
			const fragment = `#${sample.libraryName}.${sample.className}.1`;
			const suffix = sample.elementKind === "MIXIN"
				? "mixin"
				: sample.elementKind === "EXTENSION"
					? "extension-type"
					: "class";
			const url = `https://api.flutter.dev/flutter/${sample.libraryName}/${sample.className}-${suffix}.html${fragment}`;
			await envUtils.openInBrowser(url);
		}));

		this.flutterPackagesFolder = path.join(sdks.flutter, "packages/flutter/lib/src/").toLowerCase();
	}

	public async provideCodeLenses(document: TextDocument, token: CancellationToken): Promise<CodeLens[] | undefined> {
		// Ensure this file is a Flutter package file.
		const filePath = fsPath(document.uri);
		if (!filePath.toLowerCase().startsWith(this.flutterPackagesFolder))
			return;

		// Without version numbers, the best we have to tell if an outline is likely correct or stale is
		// if its length matches the document exactly.
		const expectedLength = document.getText().length;
		const outline = await this.analyzer.fileTracker.waitForOutlineWithLength(document.uri, expectedLength, token);
		if (!outline || !outline.children || !outline.children.length)
			return;

		const libraryName = filePath.substr(this.flutterPackagesFolder.length).replace("\\", "/").split("/")[0];

		const visitor = new ClassOutlineVisitor(this.logger);
		visitor.visit(outline);

		// Filter classes to those with DartPad samples.
		const samples = visitor.classes.filter((cl) => {
			// HACK: DartDocs are between the main offset and codeOffset.
			const docs = document.getText(toRange(document, cl.offset, cl.codeOffset - cl.offset));
			return dartPadSamplePattern.test(docs);
		}).map((cl) => ({ ...cl, libraryName }));

		return samples
			.filter((sample) => sample.codeOffset && sample.codeLength)
			.map((sample) => new CodeLens(
				toRange(document, sample.codeOffset, sample.codeLength),
				{
					arguments: [sample],
					command: "_dart.openDartPadSample",
					title: `Open online interactive samples for ${sample.className}`,
				},
			));
	}

	public dispose(): any {
		disposeAll(this.disposables);
	}
}

export interface DartPadSampleInfo {
	libraryName: string;
	className: string;
	elementKind: string;
	offset: number;
	length: number;
}
