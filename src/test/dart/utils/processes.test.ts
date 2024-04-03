import { strict as assert } from "assert";
import * as fs from "fs";
import * as path from "path";
import { isWin } from "../../../shared/constants";
import { nullLogger } from "../../../shared/logging";
import { runProcess, safeSpawn } from "../../../shared/processes";
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
			: "echo $1";
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
