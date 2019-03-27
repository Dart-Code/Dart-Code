import { CancellationToken, CodeActionContext, CodeActionKind, CodeActionProvider, CodeActionProviderMetadata, Command, Range, TextDocument, Uri } from "vscode";
import { isAnalyzableAndInWorkspace } from "../utils";
import { DartDiagnostic } from "./dart_diagnostic_provider";

export class OpenErrorHelpCodeActionProvider implements CodeActionProvider {

	public readonly metadata: CodeActionProviderMetadata = {
		providedCodeActionKinds: [CodeActionKind.Empty.append("help.docs")],
	};

	public provideCodeActions(document: TextDocument, range: Range, context: CodeActionContext, token: CancellationToken): Command[] | undefined {
		if (!isAnalyzableAndInWorkspace(document))
			return;

		if (!context || !context.diagnostics || !context.diagnostics.length)
			return;

		const withDocs = context.diagnostics.filter((d) => d instanceof DartDiagnostic && !!d.url);
		if (!withDocs.length)
			return;

		// TODO: Unique by error code / url

		return withDocs.map((diagnostic) => this.convertResult(diagnostic as DartDiagnostic));
	}

	private convertResult(diagnostic: DartDiagnostic): Command {
		const title = `Open help for ${diagnostic.type.toLowerCase()} '${diagnostic.code}'`;
		return {
			arguments: [Uri.parse(diagnostic.url)],
			command: "vscode.open",
			title,
		};
	}
}
