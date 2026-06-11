import { strict as assert } from "assert";
import * as fs from "fs";
import * as path from "path";
import { isWin } from "../../../shared/constants";
import { nullLogger } from "../../../shared/logging";
import { runProcess, safeSpawn } from "../../../shared/processes";
import { getFixedToolEnvForCopilotMutation } from "../../../shared/utils";
import { mkDirRecursive } from "../../../shared/utils/fs";
import { getRandomTempFolder } from "../../helpers";

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
		const shellExtension = isWin ? "bat" : "sh";
		mkDirRecursive(path.join(tempFolder, filename));
		const fullPath = path.join(tempFolder, filename, `${filename}.${shellExtension}`);
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

describe("toolEnv Copilot workaround", () => {
	it("does not apply if empty", () => {
		const res = getFixedToolEnvForCopilotMutation({
			processEnv: {},
			toolEnv: {},
		});
		assert.deepStrictEqual(res, {});
	});
	it("does not apply if no count", () => {
		const res = getFixedToolEnvForCopilotMutation({
			processEnv: {
				GIT_CONFIG_KEY_0: "safe.bareRepository",
				GIT_CONFIG_VALUE_0: "explicit",
			},
			toolEnv: {},
		});
		assert.deepStrictEqual(res, {});
	});
	it("does not apply if different value", () => {
		const res = getFixedToolEnvForCopilotMutation({
			processEnv: {
				GIT_CONFIG_COUNT: "1",
				GIT_CONFIG_KEY_0: "safe.bareRepository",
				GIT_CONFIG_VALUE_0: "explicit2",
			},
			toolEnv: {},
		});
		assert.deepStrictEqual(res, {});
	});
	it("does not apply if not last value", () => {
		const res = getFixedToolEnvForCopilotMutation({
			processEnv: {
				GIT_CONFIG_COUNT: "2",
				GIT_CONFIG_KEY_0: "safe.bareRepository",
				GIT_CONFIG_VALUE_0: "explicit",
				GIT_CONFIG_KEY_1: "something else",
				GIT_CONFIG_VALUE_1: "something else",
			},
			toolEnv: {},
		});
		assert.deepStrictEqual(res, {});
	});
	it("applies if only value", () => {
		const res = getFixedToolEnvForCopilotMutation({
			processEnv: {
				GIT_CONFIG_COUNT: "1",
				GIT_CONFIG_KEY_0: "safe.bareRepository",
				GIT_CONFIG_VALUE_0: "explicit",
			},
			toolEnv: {},
		});
		assert.deepStrictEqual(res, {
			GIT_CONFIG_COUNT: "0",
		});
	});
	it("applies if last of multiple values", () => {
		const res = getFixedToolEnvForCopilotMutation({
			processEnv: {
				GIT_CONFIG_COUNT: "2",
				GIT_CONFIG_KEY_0: "other",
				GIT_CONFIG_VALUE_0: "other",
				GIT_CONFIG_KEY_1: "safe.bareRepository",
				GIT_CONFIG_VALUE_1: "explicit",
			},
			toolEnv: {},
		});
		assert.deepStrictEqual(res, {
			GIT_CONFIG_COUNT: "1",
		});
	});
	it("does not modify other values", () => {
		const res = getFixedToolEnvForCopilotMutation({
			processEnv: {
				GIT_CONFIG_COUNT: "1",
				GIT_CONFIG_KEY_0: "safe.bareRepository",
				GIT_CONFIG_VALUE_0: "explicit",
			},
			toolEnv: {
				UNRELATED: "12345"
			},
		});
		assert.deepStrictEqual(res, {
			GIT_CONFIG_COUNT: "0",
			UNRELATED: "12345"
		});
	});
});
