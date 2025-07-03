import { CancellationToken } from "vscode";
import { isDartCodeTestRun } from "../../shared/constants";
import { Logger, SpawnedProcess } from "../../shared/interfaces";
import { RunProcessResult, runProcess, safeSpawn } from "../../shared/processes";

// Environment used when spawning Dart and Flutter processes.
let flutterRoot: string | undefined;
let toolEnv: Record<string, string> = {};
let globalFlutterArgs: string[] = [];

export function getToolEnv() {
	return toolEnv;
}

export function getGlobalFlutterArgs() {
	return globalFlutterArgs;
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

	if (!toolEnv.FLUTTER_ROOT && !process.env.FLUTTER_ROOT && flutterRoot)
		toolEnv.FLUTTER_ROOT = flutterRoot;
}

export function safeToolSpawn(workingDirectory: string | undefined, binPath: string, args: string[], envOverrides?: Record<string, string | undefined>): SpawnedProcess {
	const env = Object.assign({}, toolEnv, envOverrides) as Record<string, string | undefined> | undefined;
	return safeSpawn(workingDirectory, binPath, args, env);
}

/// Runs a process and returns the exit code, stdout, stderr. Always resolves even for non-zero exit codes.
export function runToolProcess(logger: Logger, workingDirectory: string | undefined, binPath: string, args: string[], envOverrides?: Record<string, string | undefined>, cancellationToken?: CancellationToken): Promise<RunProcessResult> {
	return runProcess(logger, binPath, args, workingDirectory, envOverrides, safeToolSpawn, cancellationToken);
}
