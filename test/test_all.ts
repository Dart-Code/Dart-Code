import * as path from "path";
import * as fs from "fs";
import * as childProcess from "child_process";

const args = ["node_modules/vscode/bin/test"];
let exitCode = 0;

function runNode(cwd: string, args: string[], env: any): Promise<number> {
	return new Promise<number>((resolve, reject) => {
		const proc = childProcess.spawn("node", args, { env, stdio: "inherit", cwd });
		proc.on("data", (data: Buffer | string) => console.log(data.toString()));
		proc.on("error", (data: Buffer | string) => console.warn(data.toString()));
		proc.on("close", (code: number) => resolve(code));
	});
}

async function runTests(testFolder: string, workspaceFolder: string, sdkPaths: string, codeVersion: string): Promise<void> {
	console.log(`Running tests from '${testFolder}' in workspace '${workspaceFolder}' using version ${codeVersion} of Code and PATH: ${sdkPaths}`);
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
	let res = await runNode(cwd, args, env);
	exitCode = exitCode || res;

	// Remap coverage output.
	if (fs.existsSync(env.COVERAGE_OUTPUT)) {
		// Note: Path wonkiness - only seems to work from out/src even if supplying -b!
		res = await runNode(
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

async function runAllTests(): Promise<void> {
	const codeVersions = ["*", "insiders"];
	const sdkPaths = [process.env.PATH_STABLE || process.env.PATH, process.env.PATH_UNSTABLE].filter((p) => p);
	for (const codeVersion of codeVersions) {
		for (const sdkPath of sdkPaths) {
			await runTests("general", "hello_world", sdkPath, codeVersion);
			await runTests("flutter", "flutter_hello_world", sdkPath, codeVersion);
		}
	}
}

runAllTests().then(() => process.exit(exitCode));
