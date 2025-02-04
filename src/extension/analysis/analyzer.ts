import * as fs from "fs";
import * as path from "path";
import * as vs from "vscode";
import { DartCapabilities } from "../../shared/capabilities/dart";
import { analyzerSnapshotPath } from "../../shared/constants";
import { DartSdks, Logger } from "../../shared/interfaces";
import { extensionVersion } from "../../shared/vscode/extension_utils";
import { isRunningLocally } from "../../shared/vscode/utils";
import { config } from "../config";

export function getAnalyzerArgs(logger: Logger, sdks: DartSdks, dartCapabilities: DartCapabilities) {
	const analyzerPath = config.analyzerPath || (
		dartCapabilities.supportsLanguageServerCommand
			? "language-server"
			: path.join(sdks.dart, analyzerSnapshotPath)
	);

	// If the ssh host is set, then we are running the analyzer on a remote machine, that same analyzer
	// might not exist on the local machine.
	if (!config.analyzerSshHost && analyzerPath !== "language-server" && !fs.existsSync(analyzerPath)) {
		const msg = "Could not find a Dart Analysis Server at " + analyzerPath;
		void vs.window.showErrorMessage(msg);
		logger.error(msg);
		throw new Error(msg);
	}

	return buildAnalyzerArgs(analyzerPath, dartCapabilities);
}

function buildAnalyzerArgs(analyzerPath: string, dartCapabilities: DartCapabilities) {
	let analyzerArgs = [];

	// Optionally start the VM service for the analyzer.
	const vmServicePort = config.analyzerVmServicePort;
	if (vmServicePort) {
		analyzerArgs.push(`--enable-vm-service=${vmServicePort}`);
		// When using LSP, printing the VM Service URI will break the protocol and
		// stop the client from working, so it needs to be hidden.
		analyzerArgs.push(`-DSILENT_OBSERVATORY=true`);
		analyzerArgs.push(`-DSILENT_VM_SERVICE=true`);
		analyzerArgs.push(`--disable-service-auth-codes`);
		analyzerArgs.push(`--no-dds`);
		if (dartCapabilities.supportsNoServeDevTools)
			analyzerArgs.push("--no-serve-devtools");
	}

	// Allow arbitrary VM args to be passed to the analysis server.
	if (config.analyzerVmAdditionalArgs)
		analyzerArgs = analyzerArgs.concat(config.analyzerVmAdditionalArgs);

	analyzerArgs.push(analyzerPath);

	if (analyzerPath === "language-server") {
		analyzerArgs.push("--protocol=lsp");
	} else {
		analyzerArgs.push("--lsp");
	}

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
