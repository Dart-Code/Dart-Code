import * as vs from "vscode";
import { disposeAll } from "../../shared/utils";
import { showCode } from "../../shared/vscode/utils";
import { LspAnalyzer } from "../analysis/analyzer_lsp";
import * as editors from "../editors";

export class LspGoToSuperCommand implements vs.Disposable {
	private disposables: vs.Disposable[] = [];

	constructor(private readonly analyzer: LspAnalyzer) {
		this.disposables.push(vs.commands.registerCommand("dart.goToSuper", this.goToSuper, this));
	}

	private async goToSuper(): Promise<void> {
		const editor = editors.getActiveDartEditor();
		if (!editor) {
			void vs.window.showWarningMessage("No active Dart editor.");
			return;
		}

		const location = await this.analyzer.getSuper(
			{
				position: this.analyzer.client.code2ProtocolConverter.asPosition(editor.selection.start),
				textDocument: this.analyzer.client.code2ProtocolConverter.asVersionedTextDocumentIdentifier(editor.document),
			},
		);

		if (!location)
			return;

		const codeLocation = this.analyzer.client.protocol2CodeConverter.asLocation(location);
		const elementDocument = await vs.workspace.openTextDocument(codeLocation.uri);
		const elementEditor = await vs.window.showTextDocument(elementDocument);
		showCode(elementEditor, codeLocation.range, codeLocation.range, codeLocation.range);
	}

	public dispose(): any {
		disposeAll(this.disposables);
	}
}
