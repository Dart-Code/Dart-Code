import * as vs from "vscode";
import { openInBrowser } from "../../shared/vscode/utils";
import { Analyzer } from "../analysis/analyzer";

export class AnalyzerCommands {

	constructor(context: vs.ExtensionContext, analyzer: Analyzer) {
		context.subscriptions.push(vs.commands.registerCommand("dart.openAnalyzerDiagnostics", async () => {
			const res = await analyzer.diagnosticGetServerPort();
			openInBrowser(`http://127.0.0.1:${res.port}/`);
		}));
	}
}
