import * as fs from "fs";
import * as path from "path";
import * as vstest from "vscode-test";

let exitCode = 0;
const cwd = process.cwd();
const testEnv = Object.create(process.env);

function yellow(message: string): string { return color(93, message); }
function color(col: number, message: string) {
	return "\u001b[" + col + "m" + message + "\u001b[0m";
}

async function runTests(testFolder: string, workspaceFolder: string, sdkPaths: string, codeVersion: string | undefined): Promise<void> {
	console.log("\n\n");
	console.log(yellow("############################################################"));
	console.log(
		yellow("## ")
		+ `Running using ${yellow(testFolder)}`
		+ ` in workspace ${yellow(workspaceFolder)}`
		+ ` using version ${yellow(codeVersion || "stable")} of Code`);
	console.log(`${yellow("##")} Looking for SDKs in:`);
	sdkPaths
		.split(path.delimiter)
		.filter((p) => p && p.toLowerCase().indexOf("dart") !== -1 || p.toLowerCase().indexOf("flutter") !== -1)
		.forEach((p) => console.log(`${yellow("##")}    ${p}`));
	console.log(yellow("############################################################"));

	// For some reason, updating PATH here doesn't get through to Code
	// even though other env vars do! 😢
	testEnv.DART_PATH_OVERRIDE = sdkPaths;
	testEnv.CODE_VERSION = codeVersion;

	// Figure out a filename for results...
	const logsName = process.env.LOGS_NAME;

	// Set some paths that are used inside the test run.
	const testRunName = testFolder.replace("/", "_");
	testEnv.TEST_RUN_NAME = testRunName;
	testEnv.DC_TEST_LOGS = path.join(cwd, ".dart_code_test_logs", `${testRunName}_${logsName}`);
	testEnv.COVERAGE_OUTPUT = path.join(cwd, ".nyc_output", `${testRunName}_${logsName}.json`);
	testEnv.TEST_XML_OUTPUT = path.join(cwd, ".test_results", `${testRunName}_${logsName}.xml`);
	testEnv.TEST_CSV_SUMMARY = path.join(cwd, ".test_results", `${logsName}_summary.csv`);

	if (!fs.existsSync(testEnv.DC_TEST_LOGS))
		fs.mkdirSync(testEnv.DC_TEST_LOGS);

	const res = await vstest.runTests({
		extensionDevelopmentPath: cwd,
		extensionTestsEnv: testEnv,
		extensionTestsPath: path.join(cwd, "out", "src", "test", testFolder),
		launchArgs: [
			path.isAbsolute(workspaceFolder)
				? workspaceFolder
				: path.join(cwd, "src", "test", "test_projects", workspaceFolder),
			"--user-data-dir",
			path.join(cwd, ".dart_code_test_data_dir"),
		],
		version: codeVersion,
	});
	exitCode = exitCode || res;

	console.log(yellow("############################################################"));
	console.log("\n\n");
}

async function runAllTests(): Promise<void> {
	if (process.env.CI) {
		const branchName = process.env.APPVEYOR_REPO_BRANCH || process.env.TRAVIS_BRANCH || process.env.GITHUB_REF;
		const commit = process.env.APPVEYOR_REPO_COMMIT || process.env.TRAVIS_COMMIT || process.env.GITHUB_SHA;

		console.log("\n\n");
		console.log(yellow("A combined test summary will be available at:"));
		console.log(yellow(`  https://dartcode.org/test-results/?${branchName}/${commit}`));
		console.log("\n\n");
	}

	const codeVersion = process.env.CODE_VERSION;
	const dartSdkPath = process.env.DART_PATH_SYMLINK || process.env.DART_PATH || process.env.PATH;
	const flutterSdkPath = process.env.FLUTTER_PATH_SYMLINK || process.env.FLUTTER_PATH || process.env.PATH;

	if (!dartSdkPath)
		throw new Error("Could not find Dart SDK");
	if (!flutterSdkPath)
		throw new Error("Could not find Flutter SDK");

	testEnv.DART_CODE_IS_TEST_RUN = true;
	testEnv.MOCHA_FORBID_ONLY = true;

	// Ensure any necessary folders exist.
	if (!fs.existsSync(".nyc_output"))
		fs.mkdirSync(".nyc_output");
	if (!fs.existsSync(".dart_code_test_logs"))
		fs.mkdirSync(".dart_code_test_logs");

	const flutterRoot = process.env.FLUTTER_ROOT || process.env.FLUTTER_PATH;
	const runDartTests = !process.env.RUN_TESTS || process.env.RUN_TESTS === "dart";
	const runFlutterTests = !process.env.RUN_TESTS || process.env.RUN_TESTS === "flutter";
	try {
		if (runDartTests) {
			await runTests("not_activated/dart_create", "empty", dartSdkPath, codeVersion);
			await runTests("dart_create_tests", "dart_create_tests.code-workspace", dartSdkPath, codeVersion);
			await runTests("dart_only", "hello_world", dartSdkPath, codeVersion);
		}
		if (runFlutterTests) {
			await runTests("multi_root", "projects.code-workspace", flutterSdkPath, codeVersion);
			await runTests("multi_project_folder", "", flutterSdkPath, codeVersion);
			await runTests("not_activated/flutter_create", "empty", flutterSdkPath, codeVersion);
			await runTests("flutter_create_tests", "flutter_create_tests.code-workspace", flutterSdkPath, codeVersion);
			await runTests("flutter_only", "flutter_hello_world", flutterSdkPath, codeVersion);
			await runTests("flutter_web_only", "flutter_web", flutterSdkPath, codeVersion);
			if (flutterRoot) {
				await runTests("flutter_repository", flutterRoot, flutterSdkPath, codeVersion);
			} else {
				console.error("FLUTTER_ROOT/FLUTTER_PATH NOT SET, SKIPPING FLUTTER REPO TESTS");
				exitCode = 1;
			}
		}
	} catch (e) {
		exitCode = 1;
		console.error(e);
	}
}

runAllTests().then(() => process.exit(exitCode));
