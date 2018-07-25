import * as vs from "vscode";
import { ParameterInfo } from "../analysis/analysis_server_types";
import { Analyzer } from "../analysis/analyzer";
import { cleanDartdoc } from "../dartdocs";
import { fsPath } from "../utils";

export class DartSignatureHelpProvider implements vs.SignatureHelpProvider {
	constructor(private readonly analyzer: Analyzer) {
	}
	public async provideSignatureHelp(document: vs.TextDocument, position: vs.Position, token: vs.CancellationToken): Promise<vs.SignatureHelp> {
		try {
			const resp = await this.analyzer.analysisGetSignature({
				file: fsPath(document.uri),
				offset: document.offsetAt(position),
			});

			const sig = new vs.SignatureInformation(resp.name, cleanDartdoc(resp.dartdoc));
			sig.parameters = resp.parameters.map((p) => new vs.ParameterInformation(this.getLabel(p)));

			const sigs = new vs.SignatureHelp();
			sigs.signatures = [sig];
			sigs.activeSignature = 0;
			sigs.activeParameter = resp.selectedParameterIndex;
			return sigs;
		} catch {
			return undefined;
		}
	}

	private getLabel(p: ParameterInfo): string {
		if (p.kind === "NAMED") {
			return `{${p.type} ${p.name}}`;
		} else if (p.kind === "OPTIONAL") {
			return `[${p.type} ${p.name}]`;
		} else {
			return `${p.type} ${p.name}`;
		}
	}
}
