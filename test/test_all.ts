import * as path from "path";
import * as fs from "fs";
import * as childProcess from "child_process";

const args = ["node_modules/vscode/bin/test"];
let exitCode = 0;

function runNode(cwd: string, args: string[], env: any) {
	const res = childProcess.spawnSync("node", args, { env, stdio: "pipe", cwd });
	if (res.error)
		throw res.error;
	if (res.output)
		res.output
			.filter((l) => l)
			.forEach((l) => console.log(l.toString().trim().replace(/\n\s*\n/g, "\n")));
	return res.status;
}

function runTests(testFolder: string, workspaceFolder: string, sdkPaths: string, codeVersion: string) {
	const cwd = process.cwd();
	const env = Object.create(process.env);
	// For some reason, updating PATH here doesn't get through to Code
	// even though other env vars do! 😢
	env.DART_PATH_OVERRIDE = sdkPaths;
	env.CODE_VERSION = codeVersion;
	env.DART_CODE_DISABLE_ANALYTICS = true;
	env.CODE_TESTS_WORKSPACE = path.join(cwd, "test", "test_projects", workspaceFolder);
	env.CODE_TESTS_PATH = path.join(cwd, "out", "test", testFolder);
	if (codeVersion === "*")
		codeVersion = "stable";
	if (!fs.existsSync(".nyc_output"))
		fs.mkdirSync(".nyc_output");
	env.COVERAGE_OUTPUT = path.join(cwd, ".nyc_output", `${testFolder}_${codeVersion}_${(new Date()).getTime()}.json`);
	let res = runNode(cwd, args, env);
	exitCode = exitCode || res;

	// Remap coverage output.
	if (fs.existsSync(env.COVERAGE_OUTPUT)) {
		// Note: Path wonkiness - only seems to work from out/src even if supplying -b!
		res = runNode(
			path.join(cwd, "out", "src"),
			[
				"../../node_modules/remap-istanbul/bin/remap-istanbul",
				"-i",
				env.COVERAGE_OUTPUT,
				"-o",
				env.COVERAGE_OUTPUT,
			],
			env,
		);
		exitCode = exitCode || res;
	}
}

const codeVersions = ["*", "insiders"];
const sdkPaths = process.env.PATH_UNSTABLE ? [null, process.env.PATH_UNSTABLE] : [null];
for (const codeVersion of codeVersions) {
	for (const sdkPath of sdkPaths) {
		runTests("general", "hello_world", sdkPath, codeVersion);
		runTests("flutter", "flutter_hello_world", sdkPath, codeVersion);
	}
}
process.exit(exitCode);
