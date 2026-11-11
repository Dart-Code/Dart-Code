import { strict as assert } from "assert";
import * as path from "path";
import * as vs from "vscode";
import { flutterPath } from "../../shared/constants";
import { PromiseCompleter } from "../../shared/utils";
import { InternalExtensionApi } from "../../shared/vscode/interfaces";
import { activate, defer, fakeCancellationToken, privateApi, sb, waitForResult } from "../helpers";
import { ChildProcessSpawnStub } from "../mocks/child_process_spawn_stub";

describe("flutter daemon", () => {
	let daemon: NonNullable<InternalExtensionApi["flutterDaemon"]>;

	before("activate", () => activate());

	beforeEach("prepare daemon", () => {
		daemon = privateApi.flutterDaemon!;
		// Because privateApi.flutterDaemon is the live daemon started during activate(),
		// startTime is already set once connected. Reset these fields before each test so
		// we can test pre-startup progress reporting (!hasStarted) and one-time startup
		// error notifications, then restore them afterwards.
		const originalStartTime = daemon.startTime;
		const originalStartupReporter = daemon.startupReporter;
		const originalHasShownStartupError = daemon.hasShownStartupError;
		daemon.startTime = undefined;
		daemon.startupReporter = undefined;
		daemon.hasShownStartupError = false;
		defer("restore daemon state", () => {
			daemon.startTime = originalStartTime;
			daemon.startupReporter = originalStartupReporter;
			daemon.hasShownStartupError = originalHasShownStartupError;
		});
	});

	it("shows an upgrade warning for version update messages from stdout", async () => {
		const showWarningMessage = sb.stub(vs.window, "showWarningMessage").resolves("Upgrade Flutter");
		const executeCommand = sb.stub(vs.commands, "executeCommand").resolves();

		await daemon.handleMessage("A new version of Flutter is available\n");

		assert.ok(showWarningMessage.calledOnceWithExactly("A new version of Flutter is available", "Upgrade Flutter"));
		assert.ok(executeCommand.calledOnceWithExactly("flutter.upgrade"));
	});

	it("shows startup errors only once for repeated requirement failures", async () => {
		const showErrorMessage = sb.stub(vs.window, "showErrorMessage").resolves(undefined);

		await daemon.handleMessage("Flutter requires Android SDK\n");
		await daemon.handleMessage("Flutter requires Android SDK\n");

		assert.equal(showErrorMessage.callCount, 1);
		assert.equal(showErrorMessage.firstCall.args[0], "Flutter requires Android SDK\n");
	});

	it("surfaces startup work messages as progress notifications", async () => {
		const report = sb.stub();
		// eslint-disable-next-line @typescript-eslint/require-await -- Keep exceptions async.
		const withProgress = sb.stub(vs.window, "withProgress").callsFake(async (_options, task) => {
			void task({ report }, fakeCancellationToken);
			return undefined;
		});

		await daemon.handleMessage("Building flutter tool\n");

		assert.equal(withProgress.firstCall.args[0].title, "Flutter Setup");
		assert.ok(report.calledOnceWithExactly({ message: "Building flutter tool\n" }));
	});

	it("does not surface the normal device daemon startup banner as progress", async () => {
		const withProgress = sb.stub(vs.window, "withProgress");

		await daemon.handleMessage("Starting device daemon\n");

		await waitForResult(() => withProgress.notCalled);
	});

	it("enables a platform globally using flutter config", async () => {
		const spawn = ChildProcessSpawnStub.flutterConfig();
		const flutterSdkPath = privateApi.workspaceContext.sdks.flutter!;

		await daemon.enablePlatformGlobally("web");

		spawn.assertCalls([{
			cwd: flutterSdkPath,
			bin: path.join(flutterSdkPath, flutterPath),
			args: ["config", "--enable-web"],
		}]);
	});

	it("treats a globally false config value as disabled", async () => {
		const spawn = ChildProcessSpawnStub.flutterConfig({ stdout: JSON.stringify({ "enable-linux": false }) });
		const flutterSdkPath = privateApi.workspaceContext.sdks.flutter!;

		assert.equal(await daemon.checkIfPlatformGloballyDisabled("linux"), true);
		spawn.assertCalls([{
			cwd: flutterSdkPath,
			bin: path.join(flutterSdkPath, flutterPath),
			args: ["config", "--machine"],
		}]);
	});

	it("does not treat an unset global config value as disabled", async () => {
		ChildProcessSpawnStub.flutterConfig({ stdout: JSON.stringify({}) });

		assert.equal(await daemon.checkIfPlatformGloballyDisabled("linux"), false);
	});

	it("returns default values without writing to stdin if shut down before daemonInitialized resolves", async () => {
		interface DaemonInternals {
			isShuttingDown: boolean;
			daemonInitializedCompleter: PromiseCompleter<void>;
			daemonInitialized: Promise<void>;
			daemonInitializedTimerId?: NodeJS.Timeout;
			process?: { stdin: NodeJS.WritableStream };
		}
		const internals = daemon as unknown as DaemonInternals;
		const originalIsShuttingDown = internals.isShuttingDown;
		const originalCompleter = internals.daemonInitializedCompleter;
		const originalInitialized = internals.daemonInitialized;
		const originalTimerId = internals.daemonInitializedTimerId;
		defer("restore daemon shutdown state", () => {
			clearTimeout(internals.daemonInitializedTimerId);
			internals.isShuttingDown = originalIsShuttingDown;
			internals.daemonInitializedCompleter = originalCompleter;
			internals.daemonInitialized = originalInitialized;
			internals.daemonInitializedTimerId = originalTimerId;
		});

		const pendingCompleter = new PromiseCompleter<void>();
		internals.isShuttingDown = false;
		internals.daemonInitializedCompleter = pendingCompleter;
		internals.daemonInitialized = pendingCompleter.promise;
		internals.daemonInitializedTimerId = setTimeout(() => pendingCompleter.resolve(), 60000).unref();

		const writeSpy = sb.spy(internals.process!.stdin, "write");

		const emulatorsPromise = daemon.getEmulators();
		const platformsPromise = daemon.getSupportedPlatforms("/fake/project");

		// Safe on the shared daemon instance because beforeEach resets startTime = undefined
		// (!hasStarted), so shutdown() returns early after clearing startup timers.
		await daemon.shutdown();

		assert.deepStrictEqual(await emulatorsPromise, []);
		assert.deepStrictEqual(await platformsPromise, { platforms: [], platformTypes: {} });
		assert.equal(internals.daemonInitializedTimerId, undefined);
		assert.equal(writeSpy.notCalled, true);
	});

	it("prompts once via startPing on clean remote exit and suppresses duplicate ping prompt on unclean exit", async () => {
		const clock = sb.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
		defer("restore fake timers", () => clock.restore());

		interface PingDaemonInternals {
			isShuttingDown: boolean;
			processExited: boolean;
			processExitCompleter: PromiseCompleter<{ code: number | null, signal: NodeJS.Signals | null }>;
			processExit: Promise<{ code: number | null, signal: NodeJS.Signals | null }>;
			daemonInitializedCompleter: PromiseCompleter<void>;
			daemonInitialized: Promise<void>;
			daemonInitializedTimerId?: NodeJS.Timeout;
			hasShownTerminatedError: boolean;
			lastShownTerminatedError?: number;
			pingIntervalId?: NodeJS.Timeout;
			startPing: (customMessage?: string) => void;
			handleExit: (code: number | null, signal: NodeJS.Signals | null) => void;
		}
		const internals = daemon as unknown as PingDaemonInternals;
		const originalIsShuttingDown = internals.isShuttingDown;
		const originalProcessExited = internals.processExited;
		const originalProcessExitCompleter = internals.processExitCompleter;
		const originalProcessExit = internals.processExit;
		const originalInitializedCompleter = internals.daemonInitializedCompleter;
		const originalInitialized = internals.daemonInitialized;
		const originalTimerId = internals.daemonInitializedTimerId;
		const originalHasShownTerminatedError = internals.hasShownTerminatedError;
		const originalLastShownTerminatedError = internals.lastShownTerminatedError;
		const originalPingIntervalId = internals.pingIntervalId;
		defer("restore daemon ping state", () => {
			clearInterval(internals.pingIntervalId);
			internals.isShuttingDown = originalIsShuttingDown;
			internals.processExited = originalProcessExited;
			internals.processExitCompleter = originalProcessExitCompleter;
			internals.processExit = originalProcessExit;
			internals.daemonInitializedCompleter = originalInitializedCompleter;
			internals.daemonInitialized = originalInitialized;
			internals.daemonInitializedTimerId = originalTimerId;
			internals.hasShownTerminatedError = originalHasShownTerminatedError;
			internals.lastShownTerminatedError = originalLastShownTerminatedError;
			internals.pingIntervalId = originalPingIntervalId;
		});

		const showInfo = sb.stub(vs.window, "showInformationMessage").resolves(undefined);
		const showWarning = sb.stub(vs.window, "showWarningMessage").resolves(undefined);

		// 1. Clean remote exit (code 0): pre-exit startup requests settle quietly, and next ping reports lost connection once.
		const exitCompleter1 = new PromiseCompleter<{ code: number | null, signal: NodeJS.Signals | null }>();
		const initCompleter1 = new PromiseCompleter<void>();
		internals.isShuttingDown = false;
		internals.processExited = false;
		internals.processExitCompleter = exitCompleter1;
		internals.processExit = exitCompleter1.promise;
		internals.daemonInitializedCompleter = initCompleter1;
		internals.daemonInitialized = initCompleter1.promise;
		internals.daemonInitializedTimerId = undefined;
		internals.hasShownTerminatedError = false;
		internals.lastShownTerminatedError = undefined;

		const startupEmulatorsPromise = daemon.getEmulators();
		internals.startPing("Custom remote lost message");
		internals.handleExit(0, null);
		assert.deepStrictEqual(await startupEmulatorsPromise, []);
		assert.equal(showWarning.callCount, 0);
		assert.equal(showInfo.callCount, 0);

		await clock.tickAsync(60 * 1000);
		assert.equal(showWarning.callCount, 0);
		assert.equal(showInfo.callCount, 1);
		assert.equal(showInfo.firstCall.args[0], "Custom remote lost message");

		// 2. Unclean remote exit (code 1): handleUncleanExit prompts once and stops/suppresses the ping.
		const exitCompleter2 = new PromiseCompleter<{ code: number | null, signal: NodeJS.Signals | null }>();
		internals.processExited = false;
		internals.processExitCompleter = exitCompleter2;
		internals.processExit = exitCompleter2.promise;
		internals.hasShownTerminatedError = false;
		internals.lastShownTerminatedError = undefined;

		internals.startPing("Custom remote lost message");
		internals.handleExit(1, null);
		assert.equal(showWarning.callCount, 1);
		assert.equal(showInfo.callCount, 1);

		await clock.tickAsync(60 * 1000);
		assert.equal(showWarning.callCount, 1);
		assert.equal(showInfo.callCount, 1);
	});
});
