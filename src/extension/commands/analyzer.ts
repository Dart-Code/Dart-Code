import * as os from "os";
import * as path from "path";
import * as vs from "vscode";
import { Analyzer } from "../../shared/analyzer";
import { issueTrackerAction, issueTrackerUri, showLogAction } from "../../shared/constants";
import { Logger } from "../../shared/interfaces";
import { getRandomInt } from "../../shared/utils/fs";
import { envUtils } from "../../shared/vscode/utils";
import { Analytics, AnalyticsEvent } from "../analytics";
import { ringLog } from "../extension";
import { openLogContents } from "../utils";
import { getLogHeader } from "../utils/log";

// Must be global, as all classes are created during an extension restart.
let forcedReanalyzeCount = 0;

export class AnalyzerCommands {
	constructor(context: vs.ExtensionContext, private readonly logger: Logger, analyzer: Analyzer, analytics: Analytics) {
		context.subscriptions.push(vs.commands.registerCommand("dart.openAnalyzerDiagnostics", async () => {
			const res = await analyzer.getDiagnosticServerPort();
			await envUtils.openInBrowser(`http://127.0.0.1:${res.port}/`);
		}));
		context.subscriptions.push(vs.commands.registerCommand("dart.restartAnalysisServer", async () => {
			logger.warn(`dart.restartAnalysisServer was invoked, restarting analysis server...`);
			forcedReanalyzeCount++;
			if (forcedReanalyzeCount === 10)
				this.showServerRestartPrompt().catch((e) => logger.error(e));
			analytics.log(AnalyticsEvent.Command_RestartAnalyzer);

			// Capture log before starting the restart.
			const logPrefix = `The Dart Analysis Server was restarted. Below is a log of the most recent ${ringLog.size} events captured before the restart.`;
			const logHeader = getLogHeader();
			const ringLogContents = ringLog.toString();
			const completeLog = `${logPrefix}${logHeader}${ringLogContents}`;

			// Restart.
			void vs.commands.executeCommand("_dart.reloadExtension", "dart.restartAnalysisServer");

			// Show a notification and offer the log file.
			const tempLogPath = path.join(os.tmpdir(), `log-${getRandomInt(0x1000, 0x10000).toString(16)}.txt`);
			const chosenAction = await vs.window.showInformationMessage("The Dart Analysis Server has been restarted", showLogAction);
			if (chosenAction === showLogAction)
				void openLogContents(undefined, completeLog, tempLogPath);

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
