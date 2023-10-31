import * as path from "path";
import { flutterPath } from "../../shared/constants";
import { Logger } from "../../shared/interfaces";
import { promptToReloadExtension } from "../utils";
import { runToolProcess } from "./processes";

let isShowingAnalyzerError = false;

export function reportAnalyzerTerminatedWithError(duringStartup = false) {
	if (isShowingAnalyzerError)
		return;
	isShowingAnalyzerError = true;
	const message = duringStartup
		? "The Dart Analyzer could not be started."
		: "The Dart Analyzer has terminated.";
	void promptToReloadExtension(message, undefined, true).then(() => isShowingAnalyzerError = false);
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
			const json = JSON.parse(proc.stdout);
			return json[flutterConfigKey] as T;
		}
		throw Error(`Failed to run "flutter config --machine" (${proc.exitCode}): ${proc.stderr}`);
	} catch (e) {
		logger.error(e);
		throw e;
	}
}
