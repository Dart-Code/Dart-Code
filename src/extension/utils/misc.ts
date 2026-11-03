import * as path from "path";
import * as vs from "vscode";
import { ExtensionRestartReason, flutterPath, showLogAction } from "../../shared/constants";
import { Logger } from "../../shared/interfaces";
import { config } from "../config";
import { ringLog } from "../extension";
import { promptToReloadExtension, showLog } from "../utils";
import { runToolProcess } from "./processes";

let isShowingAnalyzerError = false;

export function reportAnalyzerTerminatedWithError(logger: Logger, { duringStartup = false, automaticallyRestarted = false }: { duringStartup?: boolean, automaticallyRestarted?: boolean } = {}) {
	if (isShowingAnalyzerError)
		return;
	isShowingAnalyzerError = true;
	if (automaticallyRestarted) {
		const ringLogContents = ringLog.toString();
		const prompt = "The Dart Analysis Server terminated unexpectedly and has been automatically restarted. Please [file an issue on GitHub](https://github.com/dart-lang/sdk/issues/new/choose) with any error from the end of the log.";
		void vs.window.showErrorMessage(prompt, showLogAction).then((chosenAction) => {
			isShowingAnalyzerError = false;
			if (chosenAction === showLogAction)
				showLog(config.analyzerLogFile, ringLogContents);
		});
		return;
	}
	const prompt = duringStartup
		? "The Dart Analyzer could not be started."
		: "The Dart Analyzer has terminated. Please [file an issue on GitHub](https://github.com/dart-lang/sdk/issues/new/choose) with any error from the end of the log.";
	void promptToReloadExtension(logger, {
		prompt,
		offerLog: true,
		severity: "ERROR",
		specificLog: config.analyzerLogFile,
		restartReason: ExtensionRestartReason.AnalyzerTerminated,
	}).then(() => isShowingAnalyzerError = false);
}

export async function getFlutterConfigValue<T>(logger: Logger, flutterSdkPath: string | undefined, folder: string, flutterConfigKey: string): Promise<T> {
	if (!flutterSdkPath) {
		throw Error("Cannot find Android Studio without a Flutter SDK");
	}
	const binPath = path.join(flutterSdkPath, flutterPath);
	const args = ["config", "--machine"];

	try {
		const proc = await runToolProcess(logger, folder, binPath, args);
		if (proc.exitCode === 0) {
			// It's possible there is Flutter output before the JSON so trim everything before then.
			let jsonString = proc.stdout.trim();
			const firstBrace = jsonString.indexOf("{");
			if (firstBrace > 0) {
				jsonString = jsonString.substring(firstBrace);
			}
			const json = JSON.parse(jsonString) as Record<string, T>;
			return json[flutterConfigKey];
		}
		throw Error(`Failed to run "flutter config --machine" (${proc.exitCode}): ${proc.stderr}`);
	} catch (e) {
		logger.error(e);
		throw e;
	}
}
