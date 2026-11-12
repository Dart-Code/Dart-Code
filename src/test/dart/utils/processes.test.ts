import { strict as assert } from "assert";
import { EventEmitter } from "events";
import * as fs from "fs";
import * as path from "path";
import { PassThrough } from "stream";
import { isWin } from "../../../shared/constants";
import { SpawnedProcess } from "../../../shared/interfaces";
import { nullLogger } from "../../../shared/logging";
import { runProcess, safeSpawn } from "../../../shared/processes";
import { mkDirRecursive } from "../../../shared/utils/fs";
import { customScriptExt, defer, getRandomTempFolder } from "../../helpers";

const tempFolder = getRandomTempFolder();

describe("safeSpawn", () => {
	testExecution("abc");
	testExecution("a b c");
	testExecution("a(b)c");
	testExecution("a 'b' c");
	testExecution("a !$%()_+ -= []{} @~;'# ,. c");
});

function testExecution(filename: string) {
	it(`can run shell scripts with names like ${filename}`, async () => {
		mkDirRecursive(path.join(tempFolder, filename));
		const fullPath = path.join(tempFolder, filename, `${filename}.${customScriptExt}`);
		const contents = isWin
			? `
				@ECHO OFF
				SET _string=%~1
				ECHO %_string%
				`
			: `#!/usr/bin/env bash
				echo $1
				`;
		fs.writeFileSync(fullPath, contents);
		fs.chmodSync(fullPath, "775");

		// Also include the filename as arguments so we can ensure that it comes through correctly as a single argument
		// (since we only print the first argument).
		const procResult = await runProcess(nullLogger, fullPath, [filename], undefined, undefined, safeSpawn, undefined);
		const procResultJson = JSON.stringify(procResult);
		assert.equal(procResult.exitCode, 0, `Wrong exit code ${procResultJson}`);

		const outputLines = procResult.stdout.trim().split("\n").map((line) => line.trim());
		const lastLine = outputLines[outputLines.length - 1];
		assert.equal(lastLine, filename, `Output did not have expected output (${procResultJson})`);
	});
}

describe("runProcess", () => {
	it("collects stdout and stderr emitted after exit before close", async () => {
		const fakeProc = Object.assign(new EventEmitter(), {
			kill: () => true,
			pid: 9999,
			stderr: new PassThrough(),
			stdin: new PassThrough(),
			stdout: new PassThrough(),
		}) as unknown as SpawnedProcess;

		const resultPromise = runProcess(nullLogger, "dart", ["--version"], undefined, undefined, () => {
			setImmediate(() => {
				fakeProc.stdout.emit("data", Buffer.from("first "));
				fakeProc.emit("exit", 0, null);
				setImmediate(() => {
					fakeProc.stdout.emit("data", Buffer.from("second"));
					fakeProc.stderr.emit("data", Buffer.from("warn"));
					fakeProc.emit("close", 0, null);
				});
			});
			return fakeProc;
		});

		const result = await resultPromise;
		assert.equal(result.exitCode, 0);
		assert.equal(result.stdout, "first second");
		assert.equal(result.stderr, "warn");
	});

	it("does not block when a background child inherits stdio pipes", async () => {
		const script = [
			"const cp = require('child_process');",
			"const fs = require('fs');",
			"const child = cp.spawn(process.execPath, ['-e', 'setTimeout(() => {}, 30000)'], { stdio: 'inherit' });",
			"fs.writeSync(1, `${child.pid}\\n/opt/dart-sdk\\n`);",
			"process.exit(0);",
		].join(" ");

		const start = Date.now();
		const result = await runProcess(
			nullLogger,
			process.execPath,
			["-e", script],
			undefined,
			{ ELECTRON_RUN_AS_NODE: "1" },
			safeSpawn,
		);
		const elapsedMs = Date.now() - start;

		const lines = result.stdout.trim().split(/\r?\n/);
		const bgPid = Number(lines[0]);
		if (Number.isFinite(bgPid) && bgPid > 0)
			defer("Kill background child", () => { try { process.kill(bgPid); } catch { } });

		assert.equal(result.exitCode, 0);
		assert.equal(lines[1], "/opt/dart-sdk");
		assert.ok(elapsedMs < 5000, `Expected runProcess not to wait for inherited stdio pipes, took ${elapsedMs}ms`);
	});

	it("cleans up listeners and cancellation subscription when settled", async () => {
		const fakeProc = Object.assign(new EventEmitter(), {
			kill: () => true,
			pid: 9999,
			stderr: new PassThrough(),
			stdin: new PassThrough(),
			stdout: new PassThrough(),
		}) as unknown as SpawnedProcess;

		let disposed = false;
		const cancellationToken = {
			isCancellationRequested: false,
			onCancellationRequested: () => ({ dispose: () => { disposed = true; } }),
		};

		const resultPromise = runProcess(
			nullLogger,
			"dart",
			["--version"],
			undefined,
			undefined,
			() => {
				setImmediate(() => {
					fakeProc.stdout.emit("data", Buffer.from("done"));
					fakeProc.emit("exit", 0, null);
					fakeProc.emit("close", 0, null);
				});
				return fakeProc;
			},
			cancellationToken,
		);

		const result = await resultPromise;
		assert.equal(result.exitCode, 0);
		assert.equal(result.stdout, "done");
		assert.equal(disposed, true);

		fakeProc.stdout.emit("data", Buffer.from("late"));
		assert.equal(result.stdout, "done");
	});
});
