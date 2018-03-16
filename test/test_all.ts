import * as path from "path";
import * as fs from "fs";
import * as childProcess from "child_process";
const supportsColor = require("supports-color"); // tslint:disable-line:no-var-requires

const args = ["node_modules/vscode/bin/test"];
let exitCode = 0;

function red(message: string): string { return color(91, message); }
function yellow(message: string): string { return color(93, message); }
function green(message: string): string { return color(92, message); }
function color(col: number, message: string) {
	if (!supportsColor) {
		return message;
	}
	return "\u001b[" + col + "m" + message + "\u001b[0m";
}

// 1 min timeout (Travis kills us at 10 min without output).
const timeoutInMilliseconds = 1000 * 60;
function runNode(cwd: string, args: string[], env: any): Promise<number> {
	return new Promise<number>((resolve, reject) => {
		let hasClosed = false;
		const proc = childProcess.spawn("node", args, { env, stdio: "inherit", cwd });
		proc.on("data", (data: Buffer | string) => console.log(data.toString()));
		proc.on("error", (data: Buffer | string) => console.warn(data.toString()));
		proc.on("close", (code: number) => {
			hasClosed = true;
			resolve(code);
		});
		setTimeout(() => {
			if (proc && !hasClosed && !proc.killed) {
				proc.kill();
				console.log(red("Terminating process for taking too long!"));
				console.log(yellow("    " + JSON.stringify(args)));
				resolve(1);
			}
		}, timeoutInMilliseconds);
	});
}

async function runTests(testFolder: string, workspaceFolder: string, sdkPaths: string, codeVersion: string, allowFailures: boolean, runInfo: string): Promise<void> {
	console.log("\n\n");
	console.log(red("############################################################"));
	console.log(
		red("## ")
		+ `Running ${runInfo} using ${yellow(testFolder)}`
		+ ` in workspace ${yellow(workspaceFolder)}`
		+ ` using version ${yellow(codeVersion)} of Code`);
	console.log(`${red("##")} Looking for SDKs in:`);
	sdkPaths
		.split(path.delimiter)
		.filter((p) => p && p.toLowerCase().indexOf("dart") !== -1 || p.toLowerCase().indexOf("flutter") !== -1)
		.forEach((p) => console.log(`${red("##")}    ${p}`));
	if (allowFailures)
		console.log(`${red("## Failures")} are ${green("allowed")} for this run.`);
	console.log(red("############################################################"));
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
	env.COVERAGE_OUTPUT = path.join(cwd, ".nyc_output", `${testFolder.replace("/", "_")}_${codeVersion}_${(new Date()).getTime()}.json`);
	let res = await runNode(cwd, args, env);
	if (!allowFailures)
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

	console.log(red("############################################################"));
	console.log("\n\n");
}

async function runAllTests(): Promise<void> {
	const codeVersions = ["*"/*, "insiders"*/];
	const sdkPaths = [process.env.PATH_STABLE || process.env.PATH, process.env.PATH_UNSTABLE].filter((p) => p);
	let runNumber = 1;
	for (const codeVersion of codeVersions) {
		for (const sdkPath of sdkPaths) {
			// Allow failures from Insiders because it's often bad (we'll still get reports).
			const allowFailures = codeVersion === "insiders" || sdkPath === process.env.PATH_UNSTABLE;
			const totalRuns = 4 * sdkPaths.length * codeVersions.length;
			await runTests("dart_only", "hello_world", sdkPath, codeVersion, allowFailures, `${runNumber++} of ${totalRuns}`);
			await runTests("flutter_only", "flutter_hello_world", sdkPath, codeVersion, allowFailures, `${runNumber++} of ${totalRuns}`);
			await runTests("multi_root", "projects.code-workspace", sdkPath, codeVersion, allowFailures, `${runNumber++} of ${totalRuns}`);
			await runTests("not_activated/flutter_create", "empty", sdkPath, codeVersion, allowFailures, `${runNumber++} of ${totalRuns}`);
		}
	}
}

runAllTests().then(() => process.exit(exitCode));
