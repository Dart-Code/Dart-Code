import * as vs from "vscode";
import * as ls from "vscode-languageclient";
import { disposeAll } from "../../shared/utils";
import * as editors from "../../shared/vscode/editors";
import { LspAnalyzer } from "../analysis/analyzer";

abstract class LspGoToCommand implements vs.Disposable {
	protected disposables: vs.Disposable[] = [];

	abstract get failureMessage(): string;

	constructor(protected readonly analyzer: LspAnalyzer) { }

	protected async goToLocations(locations: ls.Location | ls.Location[], sourceUri: vs.Uri, sourcePosition: vs.Position): Promise<void> {
		if (!Array.isArray(locations))
			locations = [locations];

		const codeLocations = locations.map((l) => this.analyzer.client.protocol2CodeConverter.asLocation(l));
		void vs.commands.executeCommand("editor.action.goToLocations", sourceUri, sourcePosition, codeLocations, "gotoAndPeek", this.failureMessage);
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
	public readonly failureMessage = "No super class/member found for this element";

	constructor(analyzer: LspAnalyzer) {
		super(analyzer);
		this.disposables.push(vs.commands.registerCommand("dart.goToSuper", this.goTo.bind(this)));
	}

	getLocations(params: ls.TextDocumentPositionParams): Promise<ls.Location | null> {
		return this.analyzer.getSuper(params);
	}
}

export class LspGoToImportsCommand extends LspGoToRequestCommand {
	public readonly failureMessage = "No imports found for this element";

	constructor(analyzer: LspAnalyzer) {
		super(analyzer);
		this.disposables.push(vs.commands.registerCommand("dart.goToImports", this.goTo.bind(this)));
	}

	getLocations(params: ls.TextDocumentPositionParams): Promise<ls.Location[] | null> {
		return this.analyzer.getImports(params);
	}
}

export class LspGoToAugmentedCommand extends LspGoToRequestCommand {
	public readonly failureMessage = "No augmented entity found for this element";

	constructor(analyzer: LspAnalyzer) {
		super(analyzer);
		this.disposables.push(vs.commands.registerCommand("dart.goToAugmented", this.goTo.bind(this)));
	}

	getLocations(params: ls.TextDocumentPositionParams): Promise<ls.Location | null> {
		return this.analyzer.getAugmented(params);
	}
}

export class LspGoToAugmentationCommand extends LspGoToRequestCommand {
	public readonly failureMessage = "No augmentation found for this element";

	constructor(analyzer: LspAnalyzer) {
		super(analyzer);
		this.disposables.push(vs.commands.registerCommand("dart.goToAugmentation", this.goTo.bind(this)));
	}

	getLocations(params: ls.TextDocumentPositionParams): Promise<ls.Location | null> {
		return this.analyzer.getAugmentation(params);
	}
}

/**
 * Supports the dart.goToLocation command that the LSP server may use.
 */
export class LspGoToLocationCommand extends LspGoToCommand {
	// This should never be shown, as this command is only ever called by the server with a location.
	public readonly failureMessage = "No location found";

	constructor(analyzer: LspAnalyzer) {
		super(analyzer);
		this.disposables.push(vs.commands.registerCommand("dart.goToLocation", this.goToLocations.bind(this)));
	}
}
