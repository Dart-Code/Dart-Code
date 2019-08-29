import * as fs from "fs";
import * as path from "path";
import * as vstest from "vscode-test";

let exitCode = 0;
const cwd = process.cwd();
const testEnv = Object.create(process.env);

async function runTests(testFolder: string, workspaceFolder: string): Promise<void> {
	console.log(
		`Running ${testFolder} tests folder in workspace ${workspaceFolder}`);

	const testRunName = testFolder.replace("/", "_");
	const logsName = process.env.LOGS_NAME;

	testEnv.TEST_RUN_NAME = testRunName;
	testEnv.DC_TEST_LOGS = path.join(cwd, ".dart_code_test_logs", `${testRunName}_${logsName}`);
	testEnv.COVERAGE_OUTPUT = path.join(cwd, ".nyc_output", `${testRunName}_${logsName}.json`);
	testEnv.TEST_XML_OUTPUT = path.join(cwd, ".test_results", `${testRunName}_${logsName}.xml`);
	testEnv.TEST_CSV_SUMMARY = path.join(cwd, ".test_results", `${testRunName}_${logsName}_summary.csv`);

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
		version: process.env.CODE_VERSION,
	});
	exitCode = exitCode || res;

	console.log("############################################################");
	console.log("\n\n");
}

async function runAllTests(): Promise<void> {
	if (process.env.CI) {
		console.log("\n\n");
		console.log("A combined test summary will be available at:");
		console.log(`  https://dartcode.org/test-results/?${process.env.GITHUB_REF}/${process.env.GITHUB_SHA}`);
		console.log("\n\n");
	}

	testEnv.DART_CODE_IS_TEST_RUN = true;
	testEnv.MOCHA_FORBID_ONLY = true;

	// Ensure any necessary folders exist.
	if (!fs.existsSync(".nyc_output"))
		fs.mkdirSync(".nyc_output");
	if (!fs.existsSync(".dart_code_test_logs"))
		fs.mkdirSync(".dart_code_test_logs");

	try {
		if (!process.env.BOT || process.env.BOT === "dart") {
			await runTests("dart_only", "hello_world");
		}
		if (!process.env.BOT || process.env.BOT === "flutter") {
			await runTests("flutter_only", "flutter_hello_world");
		}
		if (!process.env.BOT || process.env.BOT === "flutter_web") {
			// TODO: !
		}
		if (!process.env.BOT || process.env.BOT === "flutter_web_forked") {
			await runTests("flutter_web_only", "flutter_web");
		}
		if (!process.env.BOT || process.env.BOT === "misc") {
			await runTests("dart_create_tests", "dart_create_tests.code-workspace");
			await runTests("not_activated/dart_create", "empty");
			await runTests("multi_root", "projects.code-workspace");
			await runTests("multi_project_folder", "");
			await runTests("not_activated/flutter_create", "empty");
			await runTests("not_activated/flutter_web_create", "empty");
			await runTests("flutter_create_tests", "flutter_create_tests.code-workspace");
			await runTests("flutter_web_create_tests", "flutter_web_create_tests.code-workspace");
		}
		if (!process.env.BOT || process.env.BOT === "flutter_repo") {
			if (process.env.FLUTTER_REPO_PATH) {
				await runTests("flutter_repository", process.env.FLUTTER_REPO_PATH);
			} else {
				console.error("process.env.FLUTTER_REPO_PATH not set, not running flutter_repo tests");
				exitCode = 1;
			}
		}
	} catch (e) {
		exitCode = 1;
		console.error(e);
	}
}

runAllTests().then(() => process.exit(exitCode));
