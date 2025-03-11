import * as vs from "vscode";
import { Analyzer } from "../../shared/analyzer";
import { issueTrackerAction, issueTrackerUri } from "../../shared/constants";
import { Logger } from "../../shared/interfaces";
import { envUtils } from "../../shared/vscode/utils";
import { Analytics, AnalyticsEvent } from "../analytics";

// Must be global, as all classes are created during an extension restart.
let forcedReanalyzeCount = 0;

export class AnalyzerCommands {
	constructor(context: vs.ExtensionContext, private readonly logger: Logger, analyzer: Analyzer, analytics: Analytics) {
		context.subscriptions.push(vs.commands.registerCommand("dart.openAnalyzerDiagnostics", async () => {
			const res = await analyzer.getDiagnosticServerPort();
			await envUtils.openInBrowser(`http://127.0.0.1:${res.port}/`);
		}));
		context.subscriptions.push(vs.commands.registerCommand("dart.restartAnalysisServer", async () => {
			forcedReanalyzeCount++;
			if (forcedReanalyzeCount === 10)
				this.showServerRestartPrompt().catch((e) => logger.error(e));
			analytics.log(AnalyticsEvent.Command_RestartAnalyzer);
			void vs.commands.executeCommand("_dart.reloadExtension", "dart.restartAnalysisServer");
		}));
		context.subscriptions.push(vs.commands.registerCommand("dart.forceReanalyze", async () => {
			forcedReanalyzeCount++;
			if (forcedReanalyzeCount === 10)
				this.showServerRestartPrompt().catch((e) => logger.error(e));
			analytics.log(AnalyticsEvent.Command_ForceReanalyze);
			await analyzer.forceReanalyze();
		}));
	}

	private async showServerRestartPrompt(): Promise<void> {
		const choice = await vs.window.showInformationMessage("Needing to reanalyze a lot? Please consider filing a bug with a server instrumentation log", issueTrackerAction);
		if (choice === issueTrackerAction)
			await envUtils.openInBrowser(issueTrackerUri, this.logger);
	}
}
