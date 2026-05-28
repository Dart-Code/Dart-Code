import { strict as assert } from "assert";
import * as path from "path";
import * as vs from "vscode";
import { Analytics } from "../../extension/analytics";
import { FlutterDaemon } from "../../extension/flutter/flutter_daemon";
import * as misc from "../../extension/utils/misc";
import * as processes from "../../extension/utils/processes";
import { FlutterCapabilities } from "../../shared/capabilities/flutter";
import { flutterPath } from "../../shared/constants";
import { FlutterWorkspaceContext } from "../../shared/interfaces";
import { activate, logger, privateApi, sb, waitForResult } from "../helpers";

describe("flutter daemon", () => {
	let daemon: TestFlutterDaemon;

	before("activate", () => activate());

	beforeEach("create daemon", () => {
		daemon = new TestFlutterDaemon(privateApi.workspaceContext as FlutterWorkspaceContext);
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
		const withProgress = sb.stub(vs.window, "withProgress").callsFake(async (_options, task) => {
			void task({ report });
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
		const runToolProcess = sb.stub(processes, "runToolProcess").resolves({
			exitCode: 0,
			stderr: "",
			stdout: "",
		});
		const flutterSdkPath = privateApi.workspaceContext.sdks.flutter!;

		await daemon.enablePlatformGlobally("web");

		assert.ok(runToolProcess.calledOnceWithExactly(
			daemon.logger,
			flutterSdkPath,
			path.join(flutterSdkPath, flutterPath),
			["config", "--enable-web"],
		));
	});

	it("treats a globally false config value as disabled", async () => {
		const getFlutterConfigValue = sb.stub(misc, "getFlutterConfigValue").resolves(false);
		const flutterSdkPath = privateApi.workspaceContext.sdks.flutter!;

		assert.equal(await daemon.checkIfPlatformGloballyDisabled("linux"), true);
		assert.ok(getFlutterConfigValue.calledOnceWithExactly(daemon.logger, flutterSdkPath, flutterSdkPath, "enable-linux"));
	});

	it("does not treat an unset global config value as disabled", async () => {
		sb.stub(misc, "getFlutterConfigValue").resolves(undefined);

		assert.equal(await daemon.checkIfPlatformGloballyDisabled("linux"), false);
	});
});

class TestFlutterDaemon extends FlutterDaemon {
	constructor(workspaceContext: FlutterWorkspaceContext) {
		super(logger, {} as any as Analytics, workspaceContext, FlutterCapabilities.empty);
	}

	public sendStdOut(data: string | Buffer) {
		this.handleStdOut(data);
	}

	protected createProcess(_workingDirectory: string | undefined, _binPath: string, _args: string[], _envOverrides: { envOverrides?: Record<string, string | undefined>, toolEnv?: Record<string, string | undefined> }) {
		// Prevent tests from spawning a real daemon process.
	}

	protected createNcProcess(_port: number) {
		// Prevent tests from spawning a real netcat process.
	}
}
