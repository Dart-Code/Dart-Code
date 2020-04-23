import * as fs from "fs";
import * as path from "path";
import * as vstest from "vscode-test";

let exitCode = 0;
const cwd = process.cwd();
const testEnv = Object.create(process.env);

async function runTests(testFolder: string, workspaceFolder: string, logSuffix?: string, env?: {}): Promise<void> {
	console.log(
		`Running ${testFolder} tests folder in workspace ${workspaceFolder}`);

	const logsName = process.env.LOGS_NAME;
	const testRunName = `${testFolder.replace("/", "_")}${logSuffix ? `_${logSuffix}` : ""}_${logsName}`;

	testEnv.TEST_RUN_NAME = testRunName;
	testEnv.DC_TEST_LOGS = path.join(cwd, ".dart_code_test_logs", `${testRunName}`);
	testEnv.COVERAGE_OUTPUT = path.join(cwd, ".nyc_output", `${testRunName}.json`);
	testEnv.TEST_XML_OUTPUT = path.join(cwd, ".test_results", `${testRunName}.xml`);
	testEnv.TEST_CSV_SUMMARY = path.join(cwd, ".test_results", `${testRunName}_summary.csv`);

	if (!fs.existsSync(testEnv.DC_TEST_LOGS))
		fs.mkdirSync(testEnv.DC_TEST_LOGS);

	// The VS Code download is often flaky on GH Actions, so we want to retry
	// if required - however we don't want to re-run tests if they fail, so do
	// the download step separately.
	let currentAttempt = 1;
	const maxAttempts = 5;
	while (currentAttempt <= maxAttempts) {
		try {
			console.log(`Attempting to download VS Code attempt #${currentAttempt}`);
			await vstest.downloadAndUnzipVSCode(process.env.CODE_VERSION);
			break;
		} catch (e) {
			if (currentAttempt >= maxAttempts)
				throw e;

			console.warn(`Failed to download VS Code, will retry: ${e}`);
			currentAttempt++;
		}
	}

	console.log("Running tests with pre-downloaded VS Code");
	try {
		const res = await vstest.runTests({
			extensionDevelopmentPath: cwd,
			extensionTestsEnv: { ...testEnv, ...env },
			extensionTestsPath: path.join(cwd, "out", "src", "test", testFolder),
			launchArgs: [
				path.isAbsolute(workspaceFolder)
					? workspaceFolder
					: path.join(cwd, "src", "test", "test_projects", workspaceFolder),
				"--user-data-dir",
				path.join(cwd, ".dart_code_test_data_dir", testFolder),
			],
			version: process.env.CODE_VERSION,
		});
		exitCode = exitCode || res;
	} catch (e) {
		console.error(e);
		exitCode = exitCode || 999;
	}

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
			await runTests("dart", "hello_world");
		}
		if (!process.env.BOT || process.env.BOT === "dart_lsp") {
			await runTests("dart", "hello_world", "lsp", { DART_CODE_FORCE_LSP: "true" });
		}
		if (!process.env.BOT || process.env.BOT === "dart_debug") {
			await runTests("dart_debug", "hello_world");
		}
		if (!process.env.BOT || process.env.BOT === "dart_web_debug") {
			await runTests("web_debug", "web");
		}
		if (!process.env.BOT || process.env.BOT === "flutter") {
			await runTests("flutter", "flutter_hello_world");
			await runTests("flutter_bazel", "bazel_workspace/flutter_hello_world_bazel");
		}
		if (!process.env.BOT || process.env.BOT === "flutter_lsp") {
			await runTests("flutter", "flutter_hello_world", "lsp", { DART_CODE_FORCE_LSP: "true" });
		}
		if (!process.env.BOT || process.env.BOT === "flutter_debug") {
			await runTests("flutter_debug", "flutter_hello_world");
		}
		if (!process.env.BOT || process.env.BOT === "flutter_debug_chrome") {
			await runTests("flutter_debug", "flutter_hello_world", "chrome", { FLUTTER_TEST_DEVICE_ID: "chrome" });
		}
		if (!process.env.BOT || process.env.BOT === "flutter_test_debug") {
			await runTests("flutter_test_debug", "flutter_hello_world");
		}
		if (!process.env.BOT || process.env.BOT === "misc") {
			await runTests("dart_create_tests", "dart_create_tests.code-workspace");
			await runTests("not_activated/dart_create", "empty");
			await runTests("multi_root", "projects.code-workspace");
			await runTests("multi_project_folder", "");
			await runTests("not_activated/flutter_create", "empty");
			await runTests("flutter_create_tests", "flutter_create_tests.code-workspace");
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
