import * as vs from "vscode";
import { Analyzer } from "../../shared/analyzer";
import { issueTrackerAction, issueTrackerUri } from "../../shared/constants";
import { Logger } from "../../shared/interfaces";
import { envUtils } from "../../shared/vscode/utils";

// Must be global, as all classes are created during an extension restart.
let serverRestartCount = 0;

export class AnalyzerCommands {
	constructor(context: vs.ExtensionContext, private readonly logger: Logger, analyzer: Analyzer) {
		context.subscriptions.push(vs.commands.registerCommand("dart.openAnalyzerDiagnostics", async () => {
			const res = await analyzer.getDiagnosticServerPort();
			await envUtils.openInBrowser(`http://127.0.0.1:${res.port}/`);
		}));
		context.subscriptions.push(vs.commands.registerCommand("dart.restartAnalysisServer", async () => {
			serverRestartCount++;
			if (serverRestartCount === 10)
				this.showServerRestartPrompt().catch((e) => logger.error(e));
			vs.commands.executeCommand("_dart.reloadExtension");
		}));
	}

	private async showServerRestartPrompt(): Promise<void> {
		const choice = await vs.window.showInformationMessage("Needing to restart the analysis server a lot? Please consider filing a bug with a server instrumentation log", issueTrackerAction);
		if (choice === issueTrackerAction)
			await envUtils.openInBrowser(issueTrackerUri, this.logger);

	}
}
