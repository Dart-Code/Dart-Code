import * as vs from "vscode";
import * as ls from "vscode-languageclient";
import { disposeAll } from "../../shared/utils";
import { uriComparisonString } from "../../shared/utils/fs";
import { showCode } from "../../shared/vscode/utils";
import { LspAnalyzer } from "../analysis/analyzer";
import * as editors from "../editors";

abstract class LspGoToCommand implements vs.Disposable {
	protected disposables: vs.Disposable[] = [];

	constructor(protected readonly analyzer: LspAnalyzer) { }

	protected async goToLocation(location: ls.Location): Promise<void> {
		const codeLocation = this.analyzer.client.protocol2CodeConverter.asLocation(location);
		const uri = codeLocation.uri;
		const elementDocument = await vs.workspace.openTextDocument(uri);

		const sourceUriString = uriComparisonString(uri);
		const existingTab = vs.window.tabGroups.all
			.flatMap((group) => group.tabs)
			.find((tab) => tab.input instanceof vs.TabInputText && uriComparisonString(tab.input.uri) === sourceUriString);
		const tabGroup = existingTab?.group.viewColumn;

		const elementEditor = await vs.window.showTextDocument(elementDocument, tabGroup);
		showCode(elementEditor, codeLocation.range, codeLocation.range, codeLocation.range);
	}

	protected async goToLocations(locations: ls.Location | ls.Location[], sourceUri: vs.Uri, sourcePosition: vs.Position): Promise<void> {
		if (!Array.isArray(locations))
			return this.goToLocation(locations);

		if (locations.length === 1)
			return this.goToLocation(locations[0]);

		const codeLocations = locations.map((l) => this.analyzer.client.protocol2CodeConverter.asLocation(l));
		void vs.commands.executeCommand("editor.action.goToLocations", sourceUri, sourcePosition, codeLocations, "gotoAndPeek", "No imports found for this element");
	}

	public dispose(): any {
		disposeAll(this.disposables);
	}
}

abstract class LspGoToRequestCommand extends LspGoToCommand {
	constructor(protected readonly analyzer: LspAnalyzer) {
		super(analyzer);
	}

	protected async goTo(): Promise<void> {
		const editor = editors.getActiveDartEditor();
		if (!editor) {
			void vs.window.showWarningMessage("No active Dart editor.");
			return;
		}

		const locations = await this.getLocations(
			{
				position: this.analyzer.client.code2ProtocolConverter.asPosition(editor.selection.start),
				textDocument: this.analyzer.client.code2ProtocolConverter.asVersionedTextDocumentIdentifier(editor.document),
			},
		);

		if (!locations)
			return;

		await this.goToLocations(locations, editor.document.uri, editor.selection.start);
	}

	abstract getLocations(params: ls.TextDocumentPositionParams): Promise<ls.Location | ls.Location[] | null>;

	public dispose(): any {
		disposeAll(this.disposables);
	}
}

export class LspGoToSuperCommand extends LspGoToRequestCommand {
	constructor(analyzer: LspAnalyzer) {
		super(analyzer);
		this.disposables.push(vs.commands.registerCommand("dart.goToSuper", this.goTo, this));
	}

	getLocations(params: ls.TextDocumentPositionParams): Promise<ls.Location | null> {
		return this.analyzer.getSuper(params);
	}
}

export class LspGoToImportsCommand extends LspGoToRequestCommand {
	constructor(analyzer: LspAnalyzer) {
		super(analyzer);
		this.disposables.push(vs.commands.registerCommand("dart.goToImports", this.goTo, this));
	}

	getLocations(params: ls.TextDocumentPositionParams): Promise<ls.Location[] | null> {
		return this.analyzer.getImports(params);
	}
}

export class LspGoToAugmentedCommand extends LspGoToRequestCommand {
	constructor(analyzer: LspAnalyzer) {
		super(analyzer);
		this.disposables.push(vs.commands.registerCommand("dart.goToAugmented", this.goTo, this));
	}

	getLocations(params: ls.TextDocumentPositionParams): Promise<ls.Location | null> {
		return this.analyzer.getAugmented(params);
	}
}

export class LspGoToAugmentationCommand extends LspGoToRequestCommand {
	constructor(analyzer: LspAnalyzer) {
		super(analyzer);
		this.disposables.push(vs.commands.registerCommand("dart.goToAugmentation", this.goTo, this));
	}

	getLocations(params: ls.TextDocumentPositionParams): Promise<ls.Location | null> {
		return this.analyzer.getAugmentation(params);
	}
}

/**
 * Supports the dart.goToLocation command that the LSP server may use.
 */
export class LspGoToLocationCommand extends LspGoToCommand {
	constructor(analyzer: LspAnalyzer) {
		super(analyzer);
		this.disposables.push(vs.commands.registerCommand("dart.goToLocation", this.goToLocations, this));
	}
}
