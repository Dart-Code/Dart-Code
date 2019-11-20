import * as vs from "vscode";
import { AnalysisGetSignatureResponse, ParameterInfo } from "../../shared/analysis_server_types";
import { cleanDartdoc } from "../../shared/vscode/extension_utils";
import { fsPath } from "../../shared/vscode/utils";
import { DasAnalyzerClient } from "../analysis/analyzer_das";

export class DartSignatureHelpProvider implements vs.SignatureHelpProvider {
	constructor(private readonly analyzer: DasAnalyzerClient) {
	}
	public async provideSignatureHelp(document: vs.TextDocument, position: vs.Position, token: vs.CancellationToken): Promise<vs.SignatureHelp | undefined> {
		try {
			const resp = await this.analyzer.analysisGetSignature({
				file: fsPath(document.uri),
				offset: document.offsetAt(position),
			});

			if (token && token.isCancellationRequested)
				return undefined;

			const sig = new vs.SignatureInformation(this.getSignatureLabel(resp), new vs.MarkdownString(cleanDartdoc(resp.dartdoc)));
			sig.parameters = resp.parameters.map((p) => new vs.ParameterInformation(this.getLabel(p)));

			const sigs = new vs.SignatureHelp();
			sigs.signatures = [sig];
			sigs.activeSignature = 0;
			// TODO: This isn't implemented in the server yet.
			sigs.activeParameter = -1; // resp.selectedParameterIndex;
			return sigs;
		} catch {
			return undefined;
		}
	}

	private getSignatureLabel(resp: AnalysisGetSignatureResponse): string {
		const req = resp.parameters.filter((p) => p.kind === "REQUIRED");
		const opt = resp.parameters.filter((p) => p.kind === "OPTIONAL");
		const named = resp.parameters.filter((p) => p.kind === "NAMED");
		const params = [];
		if (req.length)
			params.push(req.map(this.getLabel).join(", "));
		if (opt.length)
			params.push("[" + opt.map(this.getLabel).join(", ") + "]");
		if (named.length)
			params.push("{" + named.map(this.getLabel).join(", ") + "}");
		return `${resp.name}(${params.join(", ")})`;
	}

	private getLabel(p: ParameterInfo): string {
		const def = p.defaultValue
			? ` = ${p.defaultValue}`
			: "";
		return `${p.type} ${p.name}${def}`;
	}
}
