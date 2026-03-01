import * as vstest from "@vscode/test-electron";
import * as fs from "fs";
import * as path from "path";
import which from "which";
import { getTestSuites } from "./test_runner";

let exitCode = 0;
const cwd = process.cwd();
const testEnv = Object.create(process.env) as NodeJS.Dict<string>;
const ideOverrideEnv = process.env.BOT?.includes("-") ? process.env.BOT?.split("-").pop() : undefined;

// Read command line arguments for test filtering
const testFilterArgs = process.argv.slice(2);
if (testFilterArgs.length > 0) {
	testEnv.DART_CODE_TEST_FILTER = JSON.stringify(testFilterArgs);
	console.log(`Running tests with filter(s): ${testFilterArgs.join(", ")}`);
}

async function runTests(testFolderName: string, workspaceFolder: string, logSuffix?: string, env?: NodeJS.Dict<string>): Promise<void> {
	const testFolder = path.join(cwd, "out", "src", "test", testFolderName);
	const files = await getTestSuites(testFolder, testFilterArgs);
	if (!files.length)
		return;

	console.log("\n\n");
	console.log(`Starting "${testFolderName}" tests folder in workspace "${workspaceFolder}"...`);

	const logsName = process.env.LOGS_NAME;
	const testRunName = `${testFolderName.replace(/\//g, "_")}${logSuffix ? `_${logSuffix}` : ""}_${logsName}`;
	const logPath = path.join(cwd, ".dart_code_test_logs", `${testRunName}`);

	testEnv.TEST_RUN_NAME = testRunName;
	testEnv.DC_TEST_LOGS = logPath;
	testEnv.COVERAGE_OUTPUT = path.join(cwd, ".nyc_output", `${testRunName}.json`);
	testEnv.TEST_XML_OUTPUT = path.join(path.join(cwd, ".test_results"), `${testRunName}.xml`);

	if (!fs.existsSync(logPath))
		fs.mkdirSync(logPath);

	const codeVersion = (!process.env.BUILD_VERSION || process.env.BUILD_VERSION === "stable") ? "stable" : "insiders";

	const reporter = {
		report: () => { },
		error: console.error
	};

	let ideOverride = ideOverrideEnv;
	if (!ideOverride) {
		// The VS Code download is often flaky on GH Actions, so we want to retry
		// if required - however we don't want to re-run tests if they fail, so do
		// the download step separately.
		let currentAttempt = 1;
		const maxAttempts = 5;
		while (currentAttempt <= maxAttempts) {
			try {
				// console.log(`Attempting to download VS Code attempt #${currentAttempt}`);
				await vstest.downloadAndUnzipVSCode({ version: codeVersion, reporter, });
				break;
			} catch (e) {
				if (currentAttempt >= maxAttempts)
					throw e;

				console.warn(`Failed to download VS Code, will retry: ${e}`);
				currentAttempt++;
			}
		}
	} else {
		ideOverride = process.env[`${ideOverride.toUpperCase()}_EXE`] ?? ideOverride;
		try {
			ideOverride = await which(ideOverride);
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			throw new Error(`IDE override executable "${ideOverride}" could not be found in PATH. Ensure it is installed and available on PATH: ${message}`);
		}
	}

	try {
		const res = await vstest.runTests({
			vscodeExecutablePath: ideOverride,
			extensionDevelopmentPath: cwd,
			extensionTestsEnv: { ...testEnv, ...env },
			extensionTestsPath: testFolder,
			launchArgs: [
				path.isAbsolute(workspaceFolder)
					? workspaceFolder
					: path.join(cwd, "src", "test", "test_projects", workspaceFolder),
				"--profile-temp",
				"--crash-reporter-directory",
				path.join(cwd, ".crash_dumps", testFolderName),
				// Disable the Git extensions as these may be causing test failures on GitHub Actions:
				// https://github.com/Dart-Code/Dart-Code/runs/2297610200?check_suite_focus=true#step:23:121
				"--disable-extension",
				"vscode.git",
				"--disable-extension",
				"vscode.git-ui",
				"--disable-extension",
				"vscode.git-base",
				"--disable-extension",
				"vscode.github",
				"--disable-extension",
				"vscode.github-authentication",
				"--disable-workspace-trust",
				"--log",
				"info",
				"--sync",
				"off",
			],
			version: codeVersion,
			reporter,
		});
		exitCode = exitCode || res;
	} catch (e) {
		console.error(e);
		exitCode = exitCode || 999;
	}
}

async function runAllTests(): Promise<void> {
	console.log("\n\n");
	console.log("#############################");
	console.log("## Dart-Code Tests         ##");
	console.log("#############################");

	testEnv.DART_CODE_IS_TEST_RUN = "true";
	testEnv.MOCHA_FORBID_ONLY = "true";

	// Ensure any necessary folders exist.
	if (!fs.existsSync(".nyc_output"))
		fs.mkdirSync(".nyc_output");
	if (!fs.existsSync(".dart_code_test_logs"))
		fs.mkdirSync(".dart_code_test_logs");

	function shouldRunBot(name: string, { onlyIfExplicit } = { onlyIfExplicit: false }) {
		// If there's no BOT defined and onlyIfExplicit=false, run this bot.
		if (!onlyIfExplicit && !process.env.BOT)
			return true;

		// Otherwise, run it if it's explicitly named.
		return process.env.BOT === name
			|| process.env.BOT?.startsWith(`${name}-`);
	}

	try {
		// TODO: Generate this from shared code with generate_launch_configs.ts.
		if (shouldRunBot("dart")) {
			await runTests("dart", "hello_world", undefined);
		}
		if (shouldRunBot("flutter")) {
			await runTests("flutter", "flutter_hello_world", undefined);
		}
		if (shouldRunBot("flutter_snap", { onlyIfExplicit: true })) {
			await runTests("flutter_snap", "empty");
		}
		if (shouldRunBot("dart_debug")) {
			await runTests("dart_debug", "hello_world", undefined);
		}
		if (shouldRunBot("dart_web_debug", { onlyIfExplicit: true })) {
			await runTests("web_debug", "web");
		}
		if (shouldRunBot("flutter_debug")) {
			await runTests("flutter_debug", "flutter_hello_world", undefined);
			if (shouldRunBot("flutter_debug", { onlyIfExplicit: true })) {
				await runTests("flutter_bazel", "bazel.code-workspace", undefined);
			}
		}
		if (shouldRunBot("flutter_debug_chrome", { onlyIfExplicit: true })) {
			await runTests("flutter_debug", "flutter_hello_world", "chrome", { FLUTTER_TEST_DEVICE_ID: "chrome" });
		}
		if (shouldRunBot("flutter_test_debug")) {
			await runTests("flutter_test_debug", "flutter_hello_world", undefined);
		}
		if (shouldRunBot("misc")) {
			await runTests("dart_create_tests", "dart_create_tests.code-workspace");
			await runTests("not_activated/dart_create", "empty");
			await runTests("multi_root", "projects.code-workspace");
			await runTests("multi_project_folder", "");
			await runTests("not_activated/flutter_create", "empty");
			await runTests("flutter_create_tests", "flutter_create_tests.code-workspace");
			await runTests("dart_nested", "dart_nested");
			await runTests("dart_nested_flutter", "dart_nested_flutter");
			await runTests("dart_nested_flutter2", "dart_nested_flutter2");
		}
		if (shouldRunBot("flutter_repo", { onlyIfExplicit: true })) {
			if (process.env.FLUTTER_REPO_PATH) {
				await runTests("flutter_repository", process.env.FLUTTER_REPO_PATH);
			} else {
				console.error("process.env.FLUTTER_REPO_PATH not set, skipping flutter_repo tests");
				exitCode = 1;
			}
		}
	} catch (e) {
		exitCode = 1;
		console.error(e);
	}
}

void runAllTests().then(() => process.exit(exitCode));
