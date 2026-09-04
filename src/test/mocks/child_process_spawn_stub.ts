import { strict as assert } from "assert";
import { ChildProcess, SpawnOptions } from "child_process";
import { EventEmitter } from "events";
import * as path from "path";
import { dartVMPath, executableNames, flutterPath, isWin } from "../../shared/constants";
import { quoteAndEscapeArg, simpleCommandRegex } from "../../shared/processes";
import { privateApi, sb } from "../helpers";

// Use require() so we get a mutable object that sinon can stub.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const childProcess = require("child_process") as typeof import("child_process");

export interface SpawnedProcessCall {
	cwd: string | undefined;
	bin: string;
	args?: string[];
}

/**
 * A stub for `child_process.spawn` so tests can verify the processes
 * the extension tries to spawn without having to actually execute them
 * which can be slow.
 *
 * We stub `child_process.spawn` instead of `safeSpawn` / `safeToolSpawn`
 * wrappers because the extension packed (`out/dist`) so it has its own copy
 * of those functions.
 *
 * Only invocations matching `shouldFake` are faked so other processes (like
 * the analysis server) are still spawned normally.
 *
 *   const spawn = ChildProcessSpawnStub((_bin, args) => args[0] === "pub");
 *   await vs.commands.executeCommand(...);
 *   spawn.assertCalls([{ cwd: folder, bin: executable, args: ["pub", "add", "x"] }]);
 */
export class ChildProcessSpawnStub {
	private readonly fakedCalls: SpawnedProcessCall[] = [];

	constructor(shouldFake: (bin: string, args?: string[]) => boolean) {
		const realSpawn = childProcess.spawn as (command: string, args?: readonly string[], options?: SpawnOptions) => ChildProcess;

		sb.stub(childProcess, "spawn").callsFake((bin: string, args?: string[], opts?: SpawnOptions): unknown => {
			if (!shouldFake(bin, args))
				return realSpawn(bin, args, opts);

			this.fakedCalls.push({ cwd: opts?.cwd?.toString(), bin, args });

			const proc = new EventEmitter() as any;
			proc.pid = 12345;
			proc.stdout = new EventEmitter();
			proc.stdout.setEncoding = () => undefined;
			proc.stderr = new EventEmitter();
			proc.stderr.setEncoding = () => undefined;
			proc.kill = () => true;

			// Simulate the process completing successfully right away.
			setImmediate(() => {
				proc.exitCode = 0;
				proc.emit("exit", 0, null);
				proc.emit("close", 0, null);
			});

			return proc as ChildProcess;
		});
	}

	static includesArg(args: string[] | undefined, expectedArg: string): boolean {
		return !!args && (args.includes(expectedArg) || args.includes(`"${expectedArg}"`));
	}

	static isExecutable(binPath: string, expectedBinPath: string): boolean {
		return binPath.endsWith(expectedBinPath) || binPath.endsWith(`${expectedBinPath}"`);
	}

	static dartDoc() {
		return new ChildProcessSpawnStub((bin, args) => ChildProcessSpawnStub.isExecutable(bin, executableNames.dart) && ChildProcessSpawnStub.includesArg(args, "doc"));
	}

	static dartPub() {
		return new ChildProcessSpawnStub((bin, args) => ChildProcessSpawnStub.isExecutable(bin, executableNames.dart) && ChildProcessSpawnStub.includesArg(args, "pub"));
	}

	static flutterPub() {
		return new ChildProcessSpawnStub((bin, args) => ChildProcessSpawnStub.isExecutable(bin, executableNames.flutter) && ChildProcessSpawnStub.includesArg(args, "pub"));
	}

	public get calls(): SpawnedProcessCall[] {
		return this.fakedCalls.slice();
	}

	public assertCalls(expected: SpawnedProcessCall[]): void {
		expected = expected.map((e) => {
			const cwd = e.cwd;
			let bin = e.bin;
			let args = e.args;
			if (isWin && e.bin.endsWith(".bat")) {
				bin = simpleCommandRegex.test(bin) ? bin : `"${bin}"`;
				args = args?.map(quoteAndEscapeArg);
			}
			return { cwd, bin, args };
		});
		assert.deepStrictEqual(this.calls, expected);
	}

	public assertDartCalls(expected: Array<{ cwd: string; args: string[] }>): void {
		const dartExecutablePath = path.join(privateApi.workspaceContext.sdks.dart, dartVMPath);
		this.assertCalls(expected.map(({ cwd, args }) => ({ cwd, bin: dartExecutablePath, args })));
	}

	public assertFlutterCalls(expected: Array<{ cwd: string; args: string[] }>): void {
		const flutterExecutablePath = path.join(privateApi.workspaceContext.sdks.flutter!, flutterPath);
		this.assertCalls(expected.map(({ cwd, args }) => ({ cwd, bin: flutterExecutablePath, args: ["--suppress-analytics", ...args] })));
	}
}
