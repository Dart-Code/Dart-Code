import * as path from "path";
import * as childProcess from "child_process";

const args = ["node_modules/vscode/bin/test"];
let exitCode = 0;

function runTests(testFolder: string, workspaceFolder: string, sdkPaths: string, codeVersion: string) {
	const env = Object.create(process.env);
	// For some reason, updating PATH here doesn't get through to Code
	// even though other env vars do! 😢
	env.DART_PATH_OVERRIDE = sdkPaths;
	env.CODE_VERSION = codeVersion;
	env.CODE_TESTS_WORKSPACE = path.join(process.cwd(), "test", "test_projects", workspaceFolder);
	env.CODE_TESTS_PATH = path.join(process.cwd(), "out", "test", testFolder);
	const res = childProcess.spawnSync("node", args, { env, stdio: "pipe", cwd: process.cwd() });
	if (res.error)
		throw res.error;
	if (res.output)
		res.output
			.filter((l) => l)
			.forEach((l) => console.log(l.toString().trim().replace(/\n\s*\n/g, "\n")));
	exitCode = exitCode || res.status;
}

// Can't run insiders until this is fixed:
// https://github.com/Microsoft/vscode-extension-vscode/issues/94
const codeVersions = ["*"/*, "insiders"*/];
const sdkPaths = process.env.PATH_UNSTABLE ? [null, process.env.PATH_UNSTABLE] : [null];
for (const codeVersion of codeVersions) {
	for (const sdkPath of sdkPaths) {
		runTests("general", "hello_world", sdkPath, codeVersion);
		runTests("flutter", "flutter_hello_world", sdkPath, codeVersion);
	}
}
process.exit(exitCode);
