import * as childProcess from "child_process";
import * as fs from "fs";
import * as path from "path";
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

// Set timeout at 10 mins (Travis kills us with no output for too long).
const timeoutInMilliseconds = 1000 * 60 * 10;
function runNode(cwd: string, args: string[], env: any): Promise<number> {
	return new Promise<number>((resolve, reject) => {
		let timerWarn: NodeJS.Timer;
		let timerKill: NodeJS.Timer;
		const proc = childProcess.spawn("node", args, { env, stdio: "inherit", cwd });
		proc.on("data", (data: Buffer | string) => console.log(data.toString()));
		proc.on("error", (data: Buffer | string) => console.warn(data.toString()));
		proc.on("close", (code: number) => {
			if (timerWarn)
				clearTimeout(timerWarn);
			if (timerKill)
				clearTimeout(timerKill);
			resolve(code);
		});
		timerWarn = setTimeout(() => {
			if (!proc || proc.killed)
				return;
			console.log(yellow(`Process is still going after ${timeoutInMilliseconds / 2 / 1000}s.`));
			console.log(yellow(`Waiting another ${timeoutInMilliseconds / 2 / 1000}s before terminating`));
			console.log(yellow("    " + JSON.stringify(args)));
		}, timeoutInMilliseconds / 2);
		timerKill = setTimeout(() => {
			if (!proc || proc.killed)
				return;
			proc.kill();
			console.log(red(`Terminating process for taking too long after ${timeoutInMilliseconds / 1000}s!`));
			console.log(yellow("    " + JSON.stringify(args)));
			// We'll throw and bring the tests down here, because when this happens, the Code process doesn't
			// get terminated (only the node wrapper) so subsequent tests fail anyway.
			reject("Terminating test run due to hung process.");
		}, timeoutInMilliseconds);
	});
}

async function runTests(testFolder: string, workspaceFolder: string, sdkPaths: string, codeVersion: string, runInfo: string): Promise<void> {
	console.log("\n\n");
	console.log(yellow("############################################################"));
	console.log(
		yellow("## ")
		+ `Running ${runInfo} using ${yellow(testFolder)}`
		+ ` in workspace ${yellow(workspaceFolder)}`
		+ ` using version ${yellow(codeVersion)} of Code`);
	console.log(`${yellow("##")} Looking for SDKs in:`);
	sdkPaths
		.split(path.delimiter)
		.filter((p) => p && p.toLowerCase().indexOf("dart") !== -1 || p.toLowerCase().indexOf("flutter") !== -1)
		.forEach((p) => console.log(`${yellow("##")}    ${p}`));
	console.log(yellow("############################################################"));
	const cwd = process.cwd();
	const env = Object.create(process.env);
	// For some reason, updating PATH here doesn't get through to Code
	// even though other env vars do! 😢
	env.DART_PATH_OVERRIDE = sdkPaths;
	env.CODE_VERSION = codeVersion;
	env.DART_CODE_IS_TEST_RUN = true;
	env.MOCHA_FORBID_ONLY = true;
	if (path.isAbsolute(workspaceFolder)) {
		env.CODE_TESTS_WORKSPACE = workspaceFolder;
	} else {
		env.CODE_TESTS_WORKSPACE = path.join(cwd, "test", "test_projects", workspaceFolder);
	}
	env.CODE_TESTS_PATH = path.join(cwd, "out", "test", testFolder);

	// Figure out a filename for results...
	const dartFriendlyName = (process.env.ONLY_RUN_DART_VERSION || "local").toLowerCase();
	const codeFriendlyName = codeVersion === "*" ? "stable" : "insiders";

	// Set some paths that are used inside the test run.
	env.DC_TEST_LOGS = path.join(cwd, ".dart_code_test_logs", `${testFolder.replace("/", "_")}_${dartFriendlyName}_${codeFriendlyName}`);
	env.COVERAGE_OUTPUT = path.join(cwd, ".nyc_output", `${testFolder.replace("/", "_")}_${dartFriendlyName}_${codeFriendlyName}.json`);
	env.TEST_XML_OUTPUT = path.join(cwd, ".test_results", `${testFolder.replace("/", "_")}_${dartFriendlyName}_${codeFriendlyName}.xml`);

	// Ensure any necessary folders exist.
	if (!fs.existsSync(".nyc_output"))
		fs.mkdirSync(".nyc_output");
	if (!fs.existsSync(".dart_code_test_logs"))
		fs.mkdirSync(".dart_code_test_logs");
	if (!fs.existsSync(env.DC_TEST_LOGS))
		fs.mkdirSync(env.DC_TEST_LOGS);

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

	console.log(yellow("############################################################"));
	console.log("\n\n");
}

async function runAllTests(): Promise<void> {
	if (process.env.CI) {
		const branchName = process.env.APPVEYOR_REPO_BRANCH || process.env.TRAVIS_BRANCH;
		const commit = process.env.APPVEYOR_REPO_COMMIT || process.env.TRAVIS_COMMIT;

		console.log("\n\n");
		console.log(yellow("A combined test summary will be available at:"));
		console.log(yellow(`  https://dartcode.org/test-results/?${branchName}/${commit}`));
		console.log("\n\n");
	}

	const codeVersion = process.env.ONLY_RUN_CODE_VERSION === "DEV" ? "insiders" : "*";
	const sdkPath = process.env.DART_SDK_PATHS || process.env.PATH;

	const flutterRoot = process.env.FLUTTER_ROOT;
	const totalRuns = 6;
	let runNumber = 1;
	try {
		await runTests("dart_only", "hello_world", sdkPath, codeVersion, `${runNumber++} of ${totalRuns}`);
		await runTests("flutter_only", "flutter_hello_world", sdkPath, codeVersion, `${runNumber++} of ${totalRuns}`);
		await runTests("multi_root", "projects.code-workspace", sdkPath, codeVersion, `${runNumber++} of ${totalRuns}`);
		await runTests("multi_root_upgraded", "", sdkPath, codeVersion, `${runNumber++} of ${totalRuns}`);
		await runTests("not_activated/flutter_create", "empty", sdkPath, codeVersion, `${runNumber++} of ${totalRuns}`);
		if (flutterRoot) {
			await runTests("flutter_repository", flutterRoot, sdkPath, codeVersion, `${runNumber++} of ${totalRuns}`);
		} else {
			console.error("FLUTTER_ROOT NOT SET, SKIPPING FLUTTER REPO TESTS");
			exitCode = 1;
		}
	} catch (e) {
		exitCode = 1;
		console.error(e);
	}
}

runAllTests().then(() => process.exit(exitCode));
