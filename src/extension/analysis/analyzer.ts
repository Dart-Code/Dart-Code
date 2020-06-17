import * as fs from "fs";
import * as path from "path";
import * as vs from "vscode";
import { DartCapabilities } from "../../shared/capabilities/dart";
import { analyzerSnapshotPath } from "../../shared/constants";
import { DartSdks, Logger } from "../../shared/interfaces";
import { extensionVersion } from "../../shared/vscode/extension_utils";
import { isRunningLocally } from "../../shared/vscode/utils";
import { config } from "../config";

export function getAnalyzerArgs(logger: Logger, sdks: DartSdks, dartCapabilities: DartCapabilities, isLsp: boolean) {
	const analyzerPath = config.analyzerPath || path.join(sdks.dart, analyzerSnapshotPath);

	// If the ssh host is set, then we are running the analyzer on a remote machine, that same analyzer
	// might not exist on the local machine.
	if (!config.analyzerSshHost && !fs.existsSync(analyzerPath)) {
		const msg = "Could not find a Dart Analysis Server at " + analyzerPath;
		vs.window.showErrorMessage(msg);
		logger.error(msg);
		throw new Error(msg);
	}

	return buildAnalyzerArgs(analyzerPath, dartCapabilities, isLsp);
}

function buildAnalyzerArgs(analyzerPath: string, dartCapabilities: DartCapabilities, isLsp: boolean) {
	let analyzerArgs = [];

	// Optionally start the VM service for the analyzer.
	if (config.analyzerVmServicePort)
		analyzerArgs.push(`--enable-vm-service=${config.analyzerVmServicePort}`);

	analyzerArgs.push(analyzerPath);

	if (isLsp)
		analyzerArgs.push("--lsp");

	// Optionally start the analyzer's diagnostic web server on the given port.
	if (config.analyzerDiagnosticsPort)
		analyzerArgs.push(`--port=${config.analyzerDiagnosticsPort}`);

	// Add info about the extension that will be collected for crash reports etc.
	const clientID = isRunningLocally ? "VS-Code" : "VS-Code-Remote";
	analyzerArgs.push(`--client-id=${clientID}`);
	analyzerArgs.push(`--client-version=${extensionVersion}`);

	// The analysis server supports a verbose instrumentation log file.
	if (config.analyzerInstrumentationLogFile)
		analyzerArgs.push(`--instrumentation-log-file=${config.analyzerInstrumentationLogFile}`);

	// Allow arbitrary args to be passed to the analysis server.
	if (config.analyzerAdditionalArgs)
		analyzerArgs = analyzerArgs.concat(config.analyzerAdditionalArgs);

	return analyzerArgs;
}
