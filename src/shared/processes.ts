import * as child_process from "child_process";
import * as path from "path";
import { DartCapabilities } from "./capabilities/dart";
import { dartVMPath, isWin, pubPath } from "./constants";
import { LogCategory } from "./enums";
import { CancellationToken, Logger, SpawnedProcess } from "./interfaces";
import { logProcess } from "./logging";
import { nullToUndefined } from "./utils";

const simpleCommandRegex = new RegExp("^[\\w\\-.]+$");

export function safeSpawn(workingDirectory: string | undefined, binPath: string, args: string[], env: { [key: string]: string | undefined } | undefined): SpawnedProcess {
	const quotedArgs = args.map(quoteAndEscapeArg);
	const customEnv = Object.assign({}, process.env, env);
	// Putting quotes around something like "git" will cause it to fail, so don't do it if binPath is just a single identifier.
	binPath = simpleCommandRegex.test(binPath) ? binPath : `"${binPath}"`;
	return child_process.spawn(binPath, quotedArgs, { cwd: workingDirectory, env: customEnv, shell: true }) as SpawnedProcess;
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
	constructor(public readonly exitCode: number | undefined, public readonly stdout: string, public readonly stderr: string) { }
}

export function runProcess(logger: Logger, binPath: string, args: string[], workingDirectory: string | undefined, env: { [key: string]: string | undefined } | undefined, spawn: SpawnFunction, cancellationToken?: CancellationToken): Promise<RunProcessResult> {
	return new Promise((resolve) => {
		logger.info(`Spawning ${binPath} with args ${JSON.stringify(args)} in ${workingDirectory} with env ${JSON.stringify(env)}`);
		const proc = spawn(workingDirectory, binPath, args, env);
		cancellationToken?.onCancellationRequested(() => proc.kill());
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

type SpawnFunction = (workingDirectory: string | undefined, binPath: string, args: string[], env: { [key: string]: string | undefined } | undefined) => SpawnedProcess;

export function getPubExecutionInfo(dartCapabilities: DartCapabilities, dartSdkPath: string, args: string[]): ExecutionInfo {
	if (dartCapabilities.supportsDartPub) {
		return {
			args: ["pub", ...args],
			executable: path.join(dartSdkPath, dartVMPath),
		};
	} else {
		return {
			args,
			executable: path.join(dartSdkPath, pubPath),
		};
	}
}

export interface ExecutionInfo {
	executable: string;
	args: string[];
	cwd?: string;
	env?: { [key: string]: string };
}
