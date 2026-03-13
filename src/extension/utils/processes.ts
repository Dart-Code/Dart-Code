import * as vs from "vscode";
import { isDartCodeTestRun } from "../../shared/constants";
import { Logger, SpawnedProcess } from "../../shared/interfaces";
import { RunProcessResult, runProcess, safeSpawn } from "../../shared/processes";
import { extensionVersion } from "../../shared/vscode/extension_utils";
import { hostKind } from "../../shared/vscode/utils";

// Environment used when spawning Dart and Flutter processes.
let flutterRoot: string | undefined;
let toolEnv: Record<string, string> = {};
let globalFlutterArgs: string[] = [];

export function getToolEnv() {
	return toolEnv;
}

export function getGlobalFlutterArgs() {
	// Return a copy so we never have to worry about a caller mutating this.
	return globalFlutterArgs.slice();
}

export function setFlutterRoot(root: string) {
	flutterRoot = root;
}

export function setupToolEnv(envOverrides?: any) {
	toolEnv = {};
	globalFlutterArgs = [];

	toolEnv.FLUTTER_HOST = "VSCode";
	toolEnv.PUB_ENVIRONMENT = (toolEnv.PUB_ENVIRONMENT ? `${toolEnv.PUB_ENVIRONMENT}:` : "") + "vscode.dart-code";
	if (isDartCodeTestRun) {
		toolEnv.PUB_ENVIRONMENT += ".test.bot";
		globalFlutterArgs.push("--suppress-analytics");
	}

	// Add on any overrides.
	if (envOverrides)
		toolEnv = Object.assign(toolEnv, envOverrides);

	// Always set FLUTTER_ROOT to match the SDK we are using if we have one.
	// We used to only set this if it wasn't already, and there wasn't one on the global process, but
	// this means if the user has an invalid path set (or a different version of the SDK), things could
	// fail oddly.
	if (flutterRoot)
		toolEnv.FLUTTER_ROOT = flutterRoot;

	// Add the names/versions of each part of the tool.
	toolEnv.DASH__IDE_NAME = vs.env.appName;
	toolEnv.DASH__IDE_VERSION = vs.version;
	toolEnv.DASH__PLUGIN_NAME = "Dart-Code";
	toolEnv.DASH__PLUGIN_VERSION = extensionVersion;
	toolEnv.DASH__IDE_ENVIRONMENT = hostKind ?? "desktop";
}

export function safeToolSpawn(workingDirectory: string | undefined, binPath: string, args: string[], envOverrides?: Record<string, string | undefined>): SpawnedProcess {
	const env = Object.assign({}, toolEnv, envOverrides) as Record<string, string | undefined> | undefined;
	return safeSpawn(workingDirectory, binPath, args, env);
}

/// Runs a process and returns the exit code, stdout, stderr. Always resolves even for non-zero exit codes.
export function runToolProcess(logger: Logger, workingDirectory: string | undefined, binPath: string, args: string[], envOverrides?: Record<string, string | undefined>, cancellationToken?: vs.CancellationToken): Promise<RunProcessResult> {
	return runProcess(logger, binPath, args, workingDirectory, envOverrides, safeToolSpawn, cancellationToken);
}
