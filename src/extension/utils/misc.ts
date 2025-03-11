import * as path from "path";
import { flutterPath } from "../../shared/constants";
import { Logger } from "../../shared/interfaces";
import { config } from "../config";
import { promptToReloadExtension } from "../utils";
import { runToolProcess } from "./processes";

let isShowingAnalyzerError = false;

export function reportAnalyzerTerminatedWithError(logger: Logger, duringStartup = false) {
	if (isShowingAnalyzerError)
		return;
	isShowingAnalyzerError = true;
	const message = duringStartup
		? "The Dart Analyzer could not be started."
		: "The Dart Analyzer has terminated.";
	void promptToReloadExtension(logger, message, undefined, true, config.analyzerLogFile).then(() => isShowingAnalyzerError = false);
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
			const json = JSON.parse(jsonString);
			return json[flutterConfigKey] as T;
		}
		throw Error(`Failed to run "flutter config --machine" (${proc.exitCode}): ${proc.stderr}`);
	} catch (e) {
		logger.error(e);
		throw e;
	}
}
