import * as child_process from "child_process";
import * as path from "path";
import { DartCapabilities } from "./capabilities/dart";
import { dartVMPath, isWin } from "./constants";
import { LogCategory } from "./enums";
import { CancellationToken, Logger, SpawnedProcess } from "./interfaces";
import { logProcess } from "./logging";
import { nullToUndefined } from "./utils";

const simpleCommandRegex = new RegExp("^[\\w\\-.]+$");

export function safeSpawn(workingDirectory: string | undefined, binPath: string, args: string[], env: Record<string, string | undefined> | undefined): SpawnedProcess {
	const customEnv = Object.assign({}, process.env, env);

	// On Windows we need to use shell-execute for running `.bat` files.
	// Try to limit when we use this, because terminating a shell might not terminate
	// the spawned process, so not using shell-execute may improve reliability of
	// terminating processes.
	if (isWin && binPath.endsWith(".bat")) {
		const quotedArgs = args.map(quoteAndEscapeArg);
		// Putting quotes around something like "git" will cause it to fail, so don't do it if binPath is just a single identifier.
		binPath = simpleCommandRegex.test(binPath) ? binPath : `"${binPath}"`;
		return child_process.spawn(binPath, quotedArgs, { cwd: workingDirectory, env: customEnv, shell: true }) as SpawnedProcess;
	}

	return child_process.spawn(binPath, args, { cwd: workingDirectory, env: customEnv }) as SpawnedProcess;
}

function quoteAndEscapeArg(arg: string) {
	// Spawning processes on Windows with funny symbols in the path requires quoting. However if you quote an
	// executable with a space in its path and an argument also has a space, you have to then quote _all_ of the
	// arguments!
	// https://github.com/nodejs/node/issues/7367
	let escaped = arg.replace(/"/g, `\\"`).replace(/`/g, "\\`");
	// Additionally, on Windows escape redirection symbols with ^ if they come
	// directly after quotes (?).
	// https://ss64.com/nt/syntax-esc.html
	if (isWin)
		escaped = escaped.replace(/"([<>])/g, "\"^$1");
	return `"${escaped}"`;
}

export class RunProcessResult {
	constructor(public readonly exitCode: number, public readonly stdout: string, public readonly stderr: string) { }
}

export function runProcess(logger: Logger, binPath: string, args: string[], workingDirectory: string | undefined, env: Record<string, string | undefined> | undefined, spawn: SpawnFunction, cancellationToken?: CancellationToken): Promise<RunProcessResult> {
	return new Promise((resolve, reject) => {
		logger.info(`Spawning ${binPath} with args ${JSON.stringify(args)} in ${workingDirectory} with env ${JSON.stringify(env)}`);
		const proc = spawn(workingDirectory, binPath, args, env);
		cancellationToken?.onCancellationRequested(() => proc.kill());
		logProcess(logger, LogCategory.CommandProcesses, proc);

		const out: string[] = [];
		const err: string[] = [];
		proc.stdout.on("data", (data: Buffer) => out.push(data.toString()));
		proc.stderr.on("data", (data: Buffer) => err.push(data.toString()));
		proc.on("exit", (code) => {
			resolve(new RunProcessResult(
				nullToUndefined(code) ?? 1 // null means terminated by signal
				, out.join(""),
				err.join(""),
			));
		});
		// Handle things like ENOENT which are async and come via error, but mean exit will never fire.
		proc.on("error", (e) => reject(e));
	});
}

type SpawnFunction = (workingDirectory: string | undefined, binPath: string, args: string[], env: Record<string, string | undefined> | undefined) => SpawnedProcess;

export function getPubExecutionInfo(dartCapabilities: DartCapabilities, dartSdkPath: string, args: string[]): ExecutionInfo {
	// TODO(dantup): Inline this now there's no condition?
	return {
		args: ["pub", ...args],
		executable: path.join(dartSdkPath, dartVMPath),
	};
}

export interface ExecutionInfo {
	executable: string;
	args: string[];
	cwd?: string;
	env?: Record<string, string>;
}

export interface ProcessExitCodes {
	code: number | null,
	signal: NodeJS.Signals | null
};
