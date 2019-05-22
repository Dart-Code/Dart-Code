import * as vs from "vscode";
import { Analyzer } from "../analysis/analyzer";
import { openInBrowser } from "../utils";

export class AnalyzerCommands {

	constructor(context: vs.ExtensionContext, analyzer: Analyzer) {
		context.subscriptions.push(vs.commands.registerCommand("dart.openAnalyzerDiagnostics", async () => {
			const res = await analyzer.diagnosticGetServerPort();
			openInBrowser(`http://localhost:${res.port}/`);
		}));
	}
}
