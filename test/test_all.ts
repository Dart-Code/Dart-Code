"use strict";

import * as path from "path";
import * as childProcess from "child_process";

const env = Object.create(process.env);
const args = ["node_modules/vscode/bin/test"];
let exitCode = 0;

function runTests(testFolder: string, workspaceFolder: string) {
	env.CODE_TESTS_WORKSPACE = path.join(process.cwd(), "test", "test_projects", workspaceFolder);
	env.CODE_TESTS_PATH = path.join(process.cwd(), "out", "test", testFolder);
	const res = childProcess.spawnSync("node", args, { env, stdio: "pipe", cwd: process.cwd() });
	if (res.error)
		throw res.error;
	if (res.output)
		res.output
			.filter((l) => l)
			.forEach((l) => console.log(l.toString().trim()));
	exitCode = exitCode || res.status;
}

runTests("general", "hello_world");
// runTests('flutter', 'flutter_hello_world');
process.exit(exitCode);
