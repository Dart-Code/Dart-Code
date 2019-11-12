import * as vs from "vscode";
import { Analyzer } from "../../shared/analyzer";
import { envUtils } from "../utils/vscode/editor";

export class AnalyzerCommands {
	constructor(context: vs.ExtensionContext, analyzer: Analyzer) {
		context.subscriptions.push(vs.commands.registerCommand("dart.openAnalyzerDiagnostics", async () => {
			const res = await analyzer.getDiagnosticServerPort();
			await envUtils.openInBrowser(`http://127.0.0.1:${res.port}/`);
		}));
	}
}
