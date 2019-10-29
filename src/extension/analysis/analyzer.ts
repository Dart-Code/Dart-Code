import * as fs from "fs";
import * as path from "path";
import * as vs from "vscode";
import { analyzerSnapshotPath } from "../../shared/constants";
import { DartSdks, Logger } from "../../shared/interfaces";
import { extensionVersion } from "../../shared/vscode/extension_utils";
import { config } from "../config";
import { DartCapabilities } from "../sdk/capabilities";
import { DasAnalyzer } from "./analyzer_das";

export class Analyzer extends DasAnalyzer {
	constructor(logger: Logger, dartVMPath: string, dartCapabilities: DartCapabilities, analyzerPath: string) {
		super(logger, dartVMPath, dartCapabilities, analyzerPath);
	}
}

export function getAnalyzerArgs(logger: Logger, sdks: DartSdks, isLsp: boolean) {
	const analyzerPath = config.analyzerPath || path.join(sdks.dart, analyzerSnapshotPath);

	// If the ssh host is set, then we are running the analyzer on a remote machine, that same analyzer
	// might not exist on the local machine.
	if (!config.analyzerSshHost && !fs.existsSync(analyzerPath)) {
		const msg = "Could not find a Dart Analysis Server at " + analyzerPath;
		vs.window.showErrorMessage(msg);
		logger.error(msg);
		throw new Error(msg);
	}

	return buildAnalyzerArgs(analyzerPath, isLsp);
}

function buildAnalyzerArgs(analyzerPath: string, isLsp: boolean) {
	let analyzerArgs = [];

	// Optionally start Observatory for the analyzer.
	if (config.analyzerObservatoryPort)
		analyzerArgs.push(`--enable-vm-service=${config.analyzerObservatoryPort}`);

	analyzerArgs.push(analyzerPath);

	if (isLsp)
		analyzerArgs.push("--lsp");

	// Optionally start the analyzer's diagnostic web server on the given port.
	if (config.analyzerDiagnosticsPort)
		analyzerArgs.push(`--port=${config.analyzerDiagnosticsPort}`);

	// Add info about the extension that will be collected for crash reports etc.
	analyzerArgs.push(`--client-id=Dart-Code.dart-code`);
	analyzerArgs.push(`--client-version=${extensionVersion}`);

	// The analysis server supports a verbose instrumentation log file.
	if (config.analyzerInstrumentationLogFile)
		analyzerArgs.push(`--instrumentation-log-file=${config.analyzerInstrumentationLogFile}`);

	// Allow arbitrary args to be passed to the analysis server.
	if (config.analyzerAdditionalArgs)
		analyzerArgs = analyzerArgs.concat(config.analyzerAdditionalArgs);

	return analyzerArgs;
}
