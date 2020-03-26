import { LogCategory } from "../../shared/enums";
import { Logger, SpawnedProcess } from "../../shared/interfaces";
import { logProcess } from "../../shared/logging";
import { safeSpawn } from "../../shared/processes";
import { nullToUndefined } from "./misc";

// Environment used when spawning Dart and Flutter processes.
let toolEnv: /*{ [key: string]: string | undefined }*/ any = {};
let globalFlutterArgs: string[] = [];

export function getToolEnv() {
	return toolEnv;
}

export function getGlobalFlutterArgs() {
	return globalFlutterArgs;
}

export function setupToolEnv(envOverrides?: object) {
	toolEnv = {};
	globalFlutterArgs = [];

	toolEnv.FLUTTER_HOST = "VSCode";
	toolEnv.PUB_ENVIRONMENT = (toolEnv.PUB_ENVIRONMENT ? `${toolEnv.PUB_ENVIRONMENT}:` : "") + "vscode.dart-code";
	if (process.env.DART_CODE_IS_TEST_RUN) {
		toolEnv.PUB_ENVIRONMENT += ".test.bot";
		globalFlutterArgs.push("--suppress-analytics");
	}

	// Add on any overrides.
	if (envOverrides)
		toolEnv = Object.assign(toolEnv, envOverrides);
}
// TODO: Should we move this to extension activate?
setupToolEnv();

export function safeToolSpawn(workingDirectory: string | undefined, binPath: string, args: string[], envOverrides?: any): SpawnedProcess {
	return safeSpawn(workingDirectory, binPath, args, { envOverrides, toolEnv });
}

/// Runs a process and returns the exit code, stdout, stderr. Always resolves even for non-zero exit codes.
export function runProcess(logger: Logger, workingDirectory: string | undefined, binPath: string, args: string[], envOverrides?: any): Promise<RunProcessResult> {
	return new Promise((resolve) => {
		logger.info(`Spawning ${binPath} with args ${JSON.stringify(args)} in ${workingDirectory} with env ${JSON.stringify(envOverrides)}`);
		const proc = safeToolSpawn(workingDirectory, binPath, args, envOverrides);
		logProcess(logger, LogCategory.CommandProcesses, proc);

		const out: string[] = [];
		const err: string[] = [];
		proc.stdout.on("data", (data: Buffer) => out.push(data.toString()));
		proc.stderr.on("data", (data: Buffer) => err.push(data.toString()));
		proc.on("exit", (code) => {
			resolve(new RunProcessResult(nullToUndefined(code), out.join(""), err.join("")));
		});
	});
}

export class RunProcessResult {
	constructor(public readonly exitCode: number | undefined, public readonly stdout: string, public readonly stderr: string) { }
}
