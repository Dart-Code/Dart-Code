import * as os from "os";
import * as path from "path";
import { platformEol } from "../../shared/constants";
import { LogCategory } from "../../shared/enums";
import { getRandomInt } from "../../shared/utils/fs";
import { config } from "../config";

let extensionLogPath: string;
export function getExtensionLogPath() {
	extensionLogPath = extensionLogPath || config.extensionLogFile || path.join(process.env.DC_TEST_LOGS || os.tmpdir(), `dart-code-startup-log-${getRandomInt(0x1000, 0x10000).toString(16)}.txt`);
	return extensionLogPath;
}
export const userSelectableLogCategories: Record<string, LogCategory> = {
	"Analysis Server": LogCategory.Analyzer,
	"Analysis Server Timings": LogCategory.AnalyzerTiming,
	"Command Processes": LogCategory.CommandProcesses,
	"Dart Test": LogCategory.DartTest,
	"Dart Tooling Daemon": LogCategory.DartToolingDaemon,
	"Debugger DAP Protocol": LogCategory.DAP,
	"Debugger VM Service": LogCategory.VmService,
	"DevTools": LogCategory.DevTools,
	"Flutter Device Daemon": LogCategory.FlutterDaemon,
	"Flutter Run": LogCategory.FlutterRun,
	"Flutter Test": LogCategory.FlutterTest,
	"Web Daemon": LogCategory.WebDaemon,
};

export const analysisServerLogCategories = [
	LogCategory.Analyzer,
	LogCategory.CommandProcesses,
];

export const extensionsLogCategories = [
	LogCategory.CommandProcesses,
	LogCategory.DevTools,
	LogCategory.FlutterDaemon,
];

export const debuggingLogCategories = Object.values(userSelectableLogCategories)
	.filter((c) => c !== LogCategory.Analyzer);

const logHeader: string[] = [];
export function clearLogHeader() {
	logHeader.length = 0;
}
export function getLogHeader(suppressHeaderFooter?: boolean) {
	if (!logHeader.length)
		return "";

	return [
		...(suppressHeaderFooter ? [] : ["!! ⚠️ PLEASE REVIEW THIS LOG FOR SENSITIVE INFORMATION BEFORE SHARING ⚠️ !!"]),
		...logHeader,
		...(suppressHeaderFooter ? [] : [platformEol]),
	].join(platformEol);
}
export function addToLogHeader(f: () => string) {
	try {
		logHeader.push(f().replace(/\r/g, "").replace(/\n/g, "\r\n"));
	} catch {
		// Don't log here; we may be trying to access things that aren't available yet.
	}
}
