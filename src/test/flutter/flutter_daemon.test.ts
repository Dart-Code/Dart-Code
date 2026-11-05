import { strict as assert } from "assert";
import * as path from "path";
import * as vs from "vscode";
import { flutterPath } from "../../shared/constants";
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
});
