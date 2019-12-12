import * as vs from "vscode";
import { LanguageClient } from "vscode-languageclient";
import { SuperRequest } from "../../shared/analysis/lsp/custom_protocol";
import { showCode } from "../../shared/vscode/utils";
import * as editors from "../editors";

export class LspGoToSuperCommand implements vs.Disposable {
	private disposables: vs.Disposable[] = [];

	constructor(private readonly analyzer: LanguageClient) {
		this.disposables.push(vs.commands.registerCommand("dart.goToSuper", this.goToSuper, this));
	}

	private async goToSuper(): Promise<void> {
		const editor = editors.getActiveDartEditor();
		if (!editor) {
			vs.window.showWarningMessage("No active Dart editor.");
			return;
		}

		const location = await this.analyzer.sendRequest(
			SuperRequest.type,
			{
				position: this.analyzer.code2ProtocolConverter.asPosition(editor.selection.start),
				textDocument: this.analyzer.code2ProtocolConverter.asVersionedTextDocumentIdentifier(editor.document),
			},
		);

		if (!location)
			return;

		const codeLocation = this.analyzer.protocol2CodeConverter.asLocation(location);
		const elementDocument = await vs.workspace.openTextDocument(codeLocation.uri);
		const elementEditor = await vs.window.showTextDocument(elementDocument);
		showCode(elementEditor, codeLocation.range, codeLocation.range, codeLocation.range);
	}

	public dispose(): any {
		this.disposables.forEach((d) => d.dispose());
	}
}
