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
	testExecution("a !£$%^&()_+ -= []{} @~;'# ,. c");
});

function testExecution(filename: string) {
	it(`can run shell scripts with names like ${filename}`, async () => {
		const shellExtension = isWin ? "bat" : "sh";
		mkDirRecursive(path.join(tempFolder, filename));
		const fullPath = path.join(tempFolder, filename, `${filename}.${shellExtension}`);
		fs.writeFileSync(fullPath, "echo Hello!");

		const procResult = await runProcess(nullLogger, fullPath, [], undefined, undefined, safeSpawn, undefined);
		assert.equal(procResult.exitCode, 0);

		const outputLines = procResult.stdout.trim().split("\n").map((line) => line.trim());
		assert.ok(outputLines[outputLines.length - 2].endsWith("echo Hello!"));
		assert.equal(outputLines[outputLines.length - 1], "Hello!");
	});
}
