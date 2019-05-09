import * as minimatch from "minimatch";
import { CancellationToken, DocumentFormattingEditProvider, DocumentSelector, FormattingOptions, languages, OnTypeFormattingEditProvider, Position, Range, TextDocument, TextEdit, window, workspace } from "vscode";
import * as as from "../analysis/analysis_server_types";
import { Analyzer } from "../analysis/analyzer";
import { config } from "../config";
import { Context } from "../context";
import { IAmDisposable } from "../debug/utils";
import { fsPath } from "../utils";
import { logError } from "../utils/log";

export class DartFormattingEditProvider implements DocumentFormattingEditProvider, OnTypeFormattingEditProvider, IAmDisposable {
	constructor(private readonly analyzer: Analyzer, private readonly context: Context) {
		workspace.onDidChangeConfiguration((e) => {
			if (e.affectsConfiguration("dart.enableSdkFormatter")) {
				if (config.enableSdkFormatter)
					this.registerAllFormatters();
				else
					this.unregisterAllFormatters();
			}
		});
	}

	private readonly registeredFormatters: IAmDisposable[] = [];
	private readonly formatterRegisterFuncs: Array<() => void> = [];

	public registerDocumentFormatter(filter: DocumentSelector): void {
		this.registerFormatter(() => languages.registerDocumentFormattingEditProvider(filter, this));
	}

	public registerTypingFormatter(filter: DocumentSelector, firstTriggerCharacter: string, ...moreTriggerCharacters: string[]): void {
		this.registerFormatter(() => languages.registerOnTypeFormattingEditProvider(filter, this, firstTriggerCharacter, ...moreTriggerCharacters));
	}

	private registerFormatter(reg: () => IAmDisposable) {
		const registerAndTrack = () => this.registeredFormatters.push(reg());
		// Register the formatter immediately if enabled.
		if (config.enableSdkFormatter)
			registerAndTrack();

		// Add it to our list so we can re-register later..
		this.formatterRegisterFuncs.push(registerAndTrack);
	}

	private registerAllFormatters() {
		for (const formatterReg of this.formatterRegisterFuncs) {
			formatterReg();
		}
	}

	private unregisterAllFormatters() {
		this.registeredFormatters.forEach((s) => s.dispose());
		this.registeredFormatters.length = 0;
	}

	public async provideDocumentFormattingEdits(document: TextDocument, options: FormattingOptions, token: CancellationToken): Promise<TextEdit[]> {
		try {
			return await this.doFormat(document, true); // await is important for catch to work.
		} catch {
			if (!this.context.hasWarnedAboutFormatterSyntaxLimitation) {
				this.context.hasWarnedAboutFormatterSyntaxLimitation = true;
				window.showInformationMessage("The Dart formatter will not run if the file has syntax errors");
			}
			return undefined;
		}
	}

	public async provideOnTypeFormattingEdits(document: TextDocument, position: Position, ch: string, options: FormattingOptions, token: CancellationToken): Promise<TextEdit[] | undefined> | undefined {
		try {
			return await this.doFormat(document, false);
		} catch {
			return undefined;
		}
	}

	private async doFormat(document: TextDocument, doLogError = true): Promise<TextEdit[] | undefined> {
		if (!this.shouldFormat(document))
			return undefined;
		try {
			const resp = await this.analyzer.editFormat({
				file: fsPath(document.uri),
				lineLength: config.for(document.uri).lineLength,
				selectionLength: 0,
				selectionOffset: 0,
			});
			if (resp.edits.length === 0)
				return undefined;
			else
				return resp.edits.map((e) => this.convertData(document, e));
		} catch (e) {
			if (doLogError)
				logError(e);
			throw e;
		}
	}

	private shouldFormat(document: TextDocument): boolean {
		if (!document || !document.uri || document.uri.scheme !== "file")
			return;

		const resourceConf = config.for(document.uri);
		const path = fsPath(document.uri);

		return undefined === resourceConf.doNotFormat.find((p) => minimatch(path, p, { dot: true }));
	}

	private convertData(document: TextDocument, edit: as.SourceEdit): TextEdit {
		return new TextEdit(
			new Range(document.positionAt(edit.offset), document.positionAt(edit.offset + edit.length)),
			edit.replacement,
		);
	}

	public dispose() {
		this.unregisterAllFormatters();
	}
}
