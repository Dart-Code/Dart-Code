import * as vstest from "@vscode/test-electron";
import * as crypto from "crypto";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as readline from "readline";
import { PassThrough, Writable } from "stream";
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
	if (!files.length) {
		console.warn(`No tests found, skipping!`);
		return;
	}

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
	// Only share VSCODE_TEST_CACHE_PATH for stable builds, which extract into
	// versioned folders (`vscode-<platform>-<x.y.z>`). Insiders extracts into an
	// unversioned `vscode-<platform>-insiders` folder and deletes/replaces it
	// in-place when updated, which could collide with a running test process.
	const cachePath = codeVersion === "stable" && process.env.VSCODE_TEST_CACHE_PATH
		? path.resolve(process.env.VSCODE_TEST_CACHE_PATH)
		: undefined;

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
				ideOverride = await withCacheLock(
					cachePath,
					() => vstest.downloadAndUnzipVSCode({ version: codeVersion, cachePath, reporter }),
				);
				break;
			} catch (e) {
				if (currentAttempt >= maxAttempts)
					throw e;

				console.warn(`Failed to download VS Code, will retry: ${String(e)}`);
				currentAttempt++;
			}
		}
	} else {
		const envVarName = `${ideOverride.toUpperCase()}_EXE`;
		ideOverride = process.env[envVarName];
		if (!ideOverride || !path.isAbsolute(ideOverride))
			throw new Error(`IDE override executable (${envVarName}) must be a full absolute path (got: ${ideOverride})`);

		console.log(`Running tests with ideOverride: ${ideOverride}`);
	}

	const stdout = process.env.DART_CODE_NO_FILTER_TEST_OUTPUT ? undefined : filterOutputStreamLines(process.stdout);
	const stderr = process.env.DART_CODE_NO_FILTER_TEST_OUTPUT ? undefined : filterOutputStreamLines(process.stderr);
	// On Linux and macOS, VS Code creates its IPC socket inside user-data-dir
	// (defaulting to "<cwd>/.vscode-test/user-data/<version>-main.sock"), which
	// fails with EINVAL when the path exceeds the Unix domain socket limit
	// (103-107 chars). Use a short temp directory when cwd is long.
	const tempDir = os.tmpdir();
	const tempUserDataDir = process.platform !== "win32" && cwd.length > 50 && tempDir.length < cwd.length
		? fs.mkdtempSync(path.join(tempDir, "dcud-"))
		: undefined;
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
				...(tempUserDataDir ? ["--user-data-dir", tempUserDataDir] : []),
				"--profile-temp",
				"--crash-reporter-directory",
				path.join(cwd, ".crash_dumps", testFolderName),
				// Disable the Git extensions as these may be causing test failures on GitHub Actions
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
			stdout: stdout?.stream,
			stderr: stderr?.stream,
		});
		exitCode = exitCode || res;
	} catch (e) {
		console.error(e);
		exitCode = exitCode || 999;
	} finally {
		await stdout?.endAndWait();
		await stderr?.endAndWait();
		if (tempUserDataDir) {
			try {
				fs.rmSync(
					tempUserDataDir,
					{
						force: true,
						recursive: true,
						maxRetries: 10,
						retryDelay: 500,
					},
				);
			} catch (e) {
				console.warn(`Failed to clean up folder ${tempUserDataDir}: ${String(e)}`);
			}
		}
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

const lockHeartbeatMs = 60 * 1000;
const staleLockMs = 5 * 60 * 1000;

/**
 * Serializes VS Code downloads when a shared `cachePath` is used across
 * parallel test runs (for example across git worktrees) so concurrent runs
 * do not delete or overwrite each other's extraction directory.
 */
async function withCacheLock<T>(cachePath: string | undefined, fn: () => Promise<T>): Promise<T> {
	if (!cachePath)
		return fn();

	const releaseLock = await acquireCacheLock(path.join(cachePath, ".vscode-download-locks"));
	try {
		return await fn();
	} finally {
		await releaseLock();
	}
}

async function acquireCacheLock(locksDir: string): Promise<() => Promise<void>> {
	const ownerInfo = `active\n${os.hostname()}\n${process.pid}`;

	while (true) {
		fs.mkdirSync(locksDir, { recursive: true });

		const existing = await getActiveLocks(locksDir);
		if (existing.size > 0) {
			await new Promise((resolve) => setTimeout(resolve, 1000));
			continue;
		}

		// Give each attempt its own uniquely-named candidate file so cleaning up
		// a stale lock file can never delete another caller's newly-created lock.
		const lockName = `${process.pid}-${crypto.randomUUID()}.lock`;
		const lockPath = path.join(locksDir, lockName);
		fs.writeFileSync(lockPath, ownerInfo, { flag: "wx" });

		const heartbeat = setInterval(() => {
			try {
				const now = new Date();
				fs.utimesSync(lockPath, now, now);
			} catch {
				// Ignore transient lock contention (such as Windows AV scanners);
				// subsequent ticks will refresh well before staleLockMs expires.
			}
		}, lockHeartbeatMs);
		heartbeat.unref();

		const releaseCandidate = async () => {
			clearInterval(heartbeat);
			try {
				const fd = fs.openSync(lockPath, "r+");
				try {
					fs.writeSync(fd, "released\n", 0, "utf8");
				} finally {
					fs.closeSync(fd);
				}
			} catch {
				// Ignore if already removed or inaccessible.
			}
			await tryDeleteLockFile(lockPath);
		};

		// Re-scan after publishing our candidate file. Because every caller writes
		// its file before scanning and retains it until exiting, at most one caller
		// can observe itself as the sole active lock; any concurrent or delayed
		// caller will see multiple active files and back off.
		let acquired = false;
		try {
			const active = await getActiveLocks(locksDir);
			if (active.size === 1 && active.has(lockName)) {
				acquired = true;
				return releaseCandidate;
			}
		} finally {
			if (!acquired)
				await releaseCandidate();
		}

		await new Promise((resolve) => setTimeout(resolve, crypto.randomInt(50, 250)));
	}
}

async function getActiveLocks(locksDir: string): Promise<Set<string>> {
	let entries: string[];
	try {
		entries = fs.readdirSync(locksDir).filter((name) => name.endsWith(".lock"));
	} catch (e) {
		if ((e as NodeJS.ErrnoException).code === "ENOENT")
			return new Set();
		throw e;
	}

	const active = new Set<string>();
	for (const entry of entries) {
		const entryPath = path.join(locksDir, entry);
		if (isLockStale(entryPath)) {
			await tryDeleteLockFile(entryPath);
			continue;
		}
		active.add(entry);
	}
	return active;
}

function isLockStale(lockFile: string): boolean {
	try {
		const stat = fs.statSync(lockFile);
		if (Date.now() - stat.mtimeMs > staleLockMs)
			return true;

		const content = fs.readFileSync(lockFile, "utf8");
		if (content.startsWith("released\n"))
			return true;

		const [status, hostname, pidText] = content.trim().split("\n");
		if (status === "active" && hostname === os.hostname()) {
			const pid = parseInt(pidText, 10);
			if (!isNaN(pid) && pid > 0) {
				try {
					process.kill(pid, 0);
					return false;
				} catch (e) {
					if ((e as NodeJS.ErrnoException).code === "ESRCH")
						return true;
				}
			}
		}
		return false;
	} catch (e) {
		// Already removed by its owner or another caller.
		return (e as NodeJS.ErrnoException).code === "ENOENT";
	}
}

async function tryDeleteLockFile(lockFile: string): Promise<void> {
	try {
		await fs.promises.rm(
			lockFile,
			{
				force: true,
				recursive: true,
				// Windows can take a little time to release file handles.
				maxRetries: 10,
				retryDelay: 500,
			},
		);
	} catch (e) {
		console.warn(`Failed to clean up lock file ${lockFile}: ${String(e)}`);
	}
}

/**
 * Create a wrapper over `targetStream` that filters out noise.
 */
function filterOutputStreamLines(targetStream: Writable): { stream: Writable, endAndWait: () => Promise<void> } {
	const inputStream = new PassThrough();

	const rl = readline.createInterface({
		input: inputStream,
		crlfDelay: Infinity
	});

	rl.on("line", (line) => {
		if (shouldIncludeOutputLine(line))
			targetStream.write(`${line}\n`);
	});

	const done = new Promise<void>((resolve) => rl.once("close", resolve));
	return {
		stream: inputStream,
		endAndWait(): Promise<void> {
			inputStream.end();
			return done;
		}
	};
}

const suppressOutputPatterns = [
	/Found --crash-reporter-directory argument/i,
	/ERROR:dbus/i,
	/Exiting GPU process/i,
	/update#setState disabled/i,
	/update#ctor - updates are disabled by the environment/i,
	/Started local extension host with pid/i,
	/MCP Registry configured/i,
	/is not in the list of known options/i,
	/creating (application )?shared storage/i,
	/\[shared storage\]/i,
	/\[AccountPolicyGate\]/i,
	/mutex already exists/i,
	/Loading development extension/i,
	/Authentication provider is not/i,
	/Settings Sync:/i,
	/This is a flutter daemon ERROR event/i,
	/fallback to software WebGL has been deprecated/i,
	/GPU stall due to/i,
	/Closing VS Code gracefully/i,
	/FATAL:electron/i,
	/ERROR:(ui|gpu|third_party)/i,
	/Failed to check for extension recommendations/i,
	/Extension host with pid \d+ exited with code: 0/i,
	/\[DEP0040\] DeprecationWarning:/i,
	/Failed to autolaunch/i,
	/Failed to register VM Service ws:\/\/fake-host:123\/ws/i,
	/Performing extension reload/i,
	/Exit code:\s+0/i,
	/filterEnabledExtensions/i,
	/ExtensionHostDataProvider\.scannedExtensions:/i,
	/ProcessExtensionHostDataProvider\.localExtensions:/i,
	/Asking native host service to exit with code 0/i,
	/product\.json#extensionEnabledApiProposals/i,
	/AbstractExtensionService\./i,
	/IExtensionHostStarter\./i,
	/NativeExtensionHostFactory\./i,
	/MODULE_TYPELESS_PACKAGE_JSON/i,
	/Reparsing as ES module because module syntax was detected/i,
	/To eliminate this warning, add "type": "module"/i,
	/depends on UNKNOWN service agentSessions/i,
	/command 'antigravity\.isFileGitIgnored' not found/i,
	/An unknown error occurred. Please consult the log for more details./i,
	/DeprecationWarning:/i,
	/--trace-deprecation/i,
	/workbench#open\(\)/i,
	/\[chat-stt\]/i,
	// DialogService refusales appear twice, once with and once without the prefix, so remove the dupe
	/Error: DialogService/i,
	// Verbose stack traces from VS Code errors
	/resources\/app\/out/i,
	/extensions\/github\.copilot-chat/i,
	// New AgentHost spam
	/AgentHostProcessManager/i,
	/No token resolved for resource/i,
	/Unknown channel: agentHost/i,
	/AgentHost:renderer/i,
	/\[AgentHost\]/i,
	/\[RemoteAgentHost\]/i,
	/\[ChatModelSelection\]/i,
	// Multiline claude spam.
	/\[RemoteAgentHostProtocol\]/i,
	/code: -32603,/i,
	/message: 'ProviderCatalogUnavailableError: Provider/i,
	/^}$/i,
];
const shouldIncludeOutputLine = (line: string) => !suppressOutputPatterns.some((pattern) => pattern.test(line));

void runAllTests().then(() => process.exit(exitCode));
