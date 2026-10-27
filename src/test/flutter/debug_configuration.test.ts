import { strict as assert } from "assert";
import * as path from "path";
import * as sinon from "sinon";
import * as vs from "vscode";
import { DebuggerType, VmServiceExtension } from "../../shared/enums";
import { fsPath } from "../../shared/utils/fs";
import { flutterTestDeviceId, startFakeDebugSession } from "../debug_helpers";
import { activate, ensureArrayContainsArray, flutterHelloWorldFolder, flutterHelloWorldMainFile, flutterIntegrationTestFile, flutterTestDriverTestFile, flutterTestMainFile, getAttachConfiguration, getResolvedDebugConfiguration, privateApi, sb, setConfigForTest } from "../helpers";
import { androidEmulator, emulatedAndroidMobile, emulatediOSMobile } from "./flutter_test_devices";

describe(`flutter run debugger`, () => {
	before("activate", () => activate(null));

	describe("resolves the correct debug config", () => {
		it("for a simple script", async () => {
			const resolvedConfig = await getResolvedDebugConfiguration({
				args: ["--foo"],
				deviceId: flutterTestDeviceId,
				program: fsPath(flutterHelloWorldMainFile),
			});

			assert.ok(resolvedConfig);
			assert.equal(resolvedConfig.program, fsPath(flutterHelloWorldMainFile));
			assert.equal(resolvedConfig.cwd, fsPath(flutterHelloWorldFolder));
			ensureArrayContainsArray(resolvedConfig.toolArgs!, ["-d", flutterTestDeviceId]);
			assert.equal(resolvedConfig.toolArgs!.includes("--web-server-debug-protocol"), false);
			assert.deepStrictEqual(resolvedConfig.args, ["--foo"]);
		});

		it("when using the web-server service", async () => {
			const resolvedConfig = await getResolvedDebugConfiguration({
				deviceId: "web-server",
				program: fsPath(flutterHelloWorldMainFile),
			});

			ensureArrayContainsArray(resolvedConfig.toolArgs!, ["--web-server-debug-protocol", "ws"]);
			ensureArrayContainsArray(resolvedConfig.toolArgs!, ["--web-server-debug-injected-client-protocol", "ws"]);
		});

		it('when web renderer is set to "flutter-default"', async () => {
			await setConfigForTest("dart", "flutterWebRenderer", "flutter-default");
			const resolvedConfig = await getResolvedDebugConfiguration({
				deviceId: "web-server",
				program: fsPath(flutterHelloWorldMainFile),
			});

			assert.ok(
				!resolvedConfig.toolArgs!.includes("--web-renderer"),
				"By default, the `--web-renderer` argument should not be set",
			);
		});

		it("when web renderer is set", async () => {
			await setConfigForTest("dart", "flutterWebRenderer", "html");
			const resolvedConfig = await getResolvedDebugConfiguration({
				deviceId: "web-server",
				program: fsPath(flutterHelloWorldMainFile),
			});

			ensureArrayContainsArray(resolvedConfig.toolArgs!, ["--web-renderer", "html"]);
		});

		it("when flutterMode is set", async () => {
			const resolvedConfig = await getResolvedDebugConfiguration({
				deviceId: flutterTestDeviceId,
				flutterMode: "release",
				program: fsPath(flutterHelloWorldMainFile),
			});

			ensureArrayContainsArray(resolvedConfig.toolArgs!, ["--release"]);
		});

		it("when flutterPlatform is set", async () => {
			const resolvedConfig = await getResolvedDebugConfiguration({
				deviceId: flutterTestDeviceId,
				flutterPlatform: "android-arm",
				program: fsPath(flutterHelloWorldMainFile),
			});

			ensureArrayContainsArray(resolvedConfig.toolArgs!, ["--target-platform", "android-arm"]);
		});

		it("when flutterRunAdditionalArgs is set", async () => {
			await setConfigForTest("dart", "flutterRunAdditionalArgs", ["--no-sound-null-safety"]);
			const resolvedConfig = await getResolvedDebugConfiguration({
				program: fsPath(flutterHelloWorldMainFile),
			});

			ensureArrayContainsArray(resolvedConfig.toolArgs!, ["--no-sound-null-safety"]);
		});

		it("when vmServicePort is set", async () => {
			const resolvedConfig = await getResolvedDebugConfiguration({
				deviceId: flutterTestDeviceId,
				program: fsPath(flutterHelloWorldMainFile),
				vmServicePort: 12345,
			});

			ensureArrayContainsArray(resolvedConfig.toolArgs!, ["--host-vmservice-port", "12345"]);
		});

		it("when attaching with flutterAttachAdditionalArgs", async () => {
			await setConfigForTest("dart", "flutterAttachAdditionalArgs", ["--fake-attach-arg"]);
			const resolvedConfig = await getAttachConfiguration({
				deviceId: flutterTestDeviceId,
				program: fsPath(flutterHelloWorldMainFile),
			});

			assert.ok(resolvedConfig);
			ensureArrayContainsArray(resolvedConfig.toolArgs!, ["--fake-attach-arg"]);
		});

		it("when emulatorId matches an already-running emulator device", async () => {
			const dm = privateApi.deviceManager!;
			sb.stub(dm, "findBestEmulatorDevice").withArgs(androidEmulator.id).returns(emulatedAndroidMobile);
			const findBestEmulator = sb.stub(dm, "findBestEmulator");
			sb.stub(dm, "tryGetSupportedPlatformTypes").resolves(["android"]);
			sb.stub(dm, "isSupported").returns(true);

			const resolvedConfig = await getResolvedDebugConfiguration({
				emulatorId: androidEmulator.id,
				program: fsPath(flutterHelloWorldMainFile),
			});

			assert.ok(resolvedConfig);
			assert.equal(resolvedConfig.deviceId, emulatedAndroidMobile.id);
			assert.ok(findBestEmulator.notCalled);
		});

		it("when emulatorId launches an emulator and resolves its device", async () => {
			const dm = privateApi.deviceManager!;
			sb.stub(dm, "findBestEmulatorDevice").withArgs(androidEmulator.id).returns(undefined);
			sb.stub(dm, "findBestEmulator").withArgs(androidEmulator.id).resolves(androidEmulator);
			const launchEmulator = sb.stub(dm, "launchEmulator").resolves(true);
			sb.stub(dm, "getDeviceByEmulatorId").withArgs(androidEmulator.id).returns(emulatedAndroidMobile);
			sb.stub(dm, "tryGetSupportedPlatformTypes").resolves(["android"]);
			sb.stub(dm, "isSupported").returns(true);

			const resolvedConfig = await getResolvedDebugConfiguration({
				emulatorId: androidEmulator.id,
				program: fsPath(flutterHelloWorldMainFile),
			});

			assert.ok(resolvedConfig);
			assert.ok(launchEmulator.calledOnceWithExactly(androidEmulator, false));
			assert.equal(resolvedConfig.deviceId, emulatedAndroidMobile.id);
		});

		it("when emulatorId is not found", async () => {
			const dm = privateApi.deviceManager!;
			sb.stub(dm, "findBestEmulatorDevice").withArgs("missing_emu").returns(undefined);
			sb.stub(dm, "findBestEmulator").withArgs("missing_emu").resolves(undefined);
			const showInformationMessage = sb.stub(vs.window, "showInformationMessage").resolves(undefined);

			const resolvedConfig = await getResolvedDebugConfiguration({
				emulatorId: "missing_emu",
				program: fsPath(flutterHelloWorldMainFile),
			});

			assert.equal(resolvedConfig, undefined);
			assert.ok(showInformationMessage.calledOnceWithExactly(`Emulator "missing_emu" was not found`));
		});

		it("when deviceId is not found", async () => {
			const dm = privateApi.deviceManager!;
			sb.stub(dm, "waitForBestDevice").withArgs("missing_device", sinon.match.any).resolves(undefined);
			const showInformationMessage = sb.stub(vs.window, "showInformationMessage").resolves(undefined);

			const resolvedConfig = await getResolvedDebugConfiguration({
				deviceId: "missing_device",
				program: fsPath(flutterHelloWorldMainFile),
			});

			assert.equal(resolvedConfig, undefined);
			assert.ok(showInformationMessage.calledOnceWithExactly(`Device "missing_device" was not found`));
		});

		it("when device is unsupported for project and device picker returns an unsupported device or undefined", async () => {
			const dm = privateApi.deviceManager!;
			sb.stub(dm, "waitForBestDevice").resolves(emulatediOSMobile);
			sb.stub(dm, "tryGetSupportedPlatformTypes").resolves(["android"]);
			sb.stub(dm, "isSupported").returns(false);
			const showDevicePicker = sb.stub(dm, "showDevicePicker");
			const showInformationMessage = sb.stub(vs.window, "showInformationMessage").resolves(undefined);

			// User selects a device from the picker that is still unsupported.
			showDevicePicker.resolves(emulatediOSMobile);
			const invalidDeviceConfig = await getResolvedDebugConfiguration({
				deviceId: emulatediOSMobile.id,
				program: fsPath(flutterHelloWorldMainFile),
			});
			assert.equal(invalidDeviceConfig, undefined);
			assert.ok(showDevicePicker.calledOnce);
			assert.ok(showInformationMessage.calledOnceWithExactly("Cannot launch without a valid device for this project"));

			// User cancels the device picker (no active device).
			showDevicePicker.resetHistory();
			showInformationMessage.resetHistory();
			showDevicePicker.resolves(undefined);
			const noActiveDeviceConfig = await getResolvedDebugConfiguration({
				deviceId: emulatediOSMobile.id,
				program: fsPath(flutterHelloWorldMainFile),
			});
			assert.equal(noActiveDeviceConfig, undefined);
			assert.ok(showDevicePicker.calledOnce);
			assert.ok(showInformationMessage.calledOnceWithExactly("Cannot launch without an active device"));
		});

		it("warns when console is set to terminal in a Flutter project", async () => {
			const showWarningMessage = sb.stub(vs.window, "showWarningMessage").resolves(undefined);

			const resolvedConfig = await getResolvedDebugConfiguration({
				console: "terminal",
				deviceId: flutterTestDeviceId,
				program: fsPath(flutterHelloWorldMainFile),
			});

			assert.ok(resolvedConfig);
			assert.ok(showWarningMessage.calledOnceWithExactly(`Flutter projects do not support "terminal" or "externalTerminal" for the "console" setting of a launch configuration. This setting will be ignored.`));
		});
	});
});

describe("flutter test debugger", () => {
	before("activate", () => activate(null));

	describe("resolves the correct debug config", () => {
		it("for a simple script", async () => {
			const resolvedConfig = await getResolvedDebugConfiguration({
				args: ["--foo"],
				program: fsPath(flutterTestMainFile),
			});

			assert.ok(resolvedConfig);
			assert.equal(resolvedConfig.program, fsPath(flutterTestMainFile));
			assert.equal(resolvedConfig.cwd, fsPath(flutterHelloWorldFolder));
			assert.deepStrictEqual(resolvedConfig.args, ["--foo"]);
		});

		it("when flutterTestAdditionalArgs is set", async () => {
			await setConfigForTest("dart", "flutterTestAdditionalArgs", ["--no-sound-null-safety"]);
			const resolvedConfig = await getResolvedDebugConfiguration({
				program: fsPath(flutterTestMainFile),
			});

			ensureArrayContainsArray(resolvedConfig.toolArgs!, ["--no-sound-null-safety"]);
		});

		it("when suppressTestTimeouts is set", async () => {
			await setConfigForTest("dart", "suppressTestTimeouts", "always");
			const resolvedConfig = await getResolvedDebugConfiguration({
				program: fsPath(flutterTestMainFile),
			});

			ensureArrayContainsArray(resolvedConfig.toolArgs!, ["--timeout"]);
		});

		it("when running a test folder", async () => {
			// Running an entire Flutter test folder forces noDebug=true because multiple VM service sessions are not supported.
			const resolvedConfig = await getResolvedDebugConfiguration({
				program: path.join(fsPath(flutterHelloWorldFolder), "test"),
			});

			assert.ok(resolvedConfig);
			assert.equal(resolvedConfig.noDebug, true);
			assert.equal(resolvedConfig.debuggerType, DebuggerType.FlutterTest);
		});

		it("when runTestsOnDevice is set with and without a test filter", async () => {
			const showWarningMessage = sb.stub(vs.window, "showWarningMessage").resolves(undefined);

			// Non-integration test with a filter falls back to FlutterTest with a warning and preserves the query string.
			const filteredConfig = await getResolvedDebugConfiguration({
				deviceId: flutterTestDeviceId,
				program: `${fsPath(flutterTestMainFile)}?name=some`,
				runTestsOnDevice: true,
			});
			assert.ok(filteredConfig);
			assert.equal(filteredConfig.debuggerType, DebuggerType.FlutterTest);
			assert.equal(filteredConfig.program, `${fsPath(flutterTestMainFile)}?name=some`);
			assert.ok(showWarningMessage.calledOnceWithExactly("Running with 'flutter test' as 'runTestsOnDevice' is not supported for individual tests."));

			// Non-integration test without a filter uses Flutter debugger to run on device.
			showWarningMessage.resetHistory();
			const unfilteredConfig = await getResolvedDebugConfiguration({
				deviceId: flutterTestDeviceId,
				program: fsPath(flutterTestMainFile),
				runTestsOnDevice: true,
			});
			assert.ok(unfilteredConfig);
			assert.equal(unfilteredConfig.debuggerType, DebuggerType.Flutter);
			assert.ok(showWarningMessage.notCalled);

			// Integration tests always use FlutterTest debugger even when runTestsOnDevice is set,
			// and require selecting a valid device when none is active.
			const dm = privateApi.deviceManager!;
			dm.currentDevice = undefined;
			sb.stub(dm, "tryGetSupportedPlatformTypes").resolves(["android"]);
			const showDevicePicker = sb.stub(dm, "showDevicePicker").resolves(emulatedAndroidMobile);

			const integrationConfig = await getResolvedDebugConfiguration({
				program: fsPath(flutterIntegrationTestFile),
				runTestsOnDevice: true,
			});
			assert.ok(integrationConfig);
			assert.equal(integrationConfig.debuggerType, DebuggerType.FlutterTest);
			assert.ok(showDevicePicker.calledOnce);
			assert.equal(integrationConfig.deviceId, emulatedAndroidMobile.id);
			ensureArrayContainsArray(integrationConfig.toolArgs!, ["-d", emulatedAndroidMobile.id]);
		});

		it("for test_driver tests with 0, >1, uninitialised, and valid instrumented apps", async () => {
			const showErrorMessage = sb.stub(vs.window, "showErrorMessage").resolves(undefined);

			// 0 running instrumented apps.
			const noAppConfig = await getResolvedDebugConfiguration({
				program: fsPath(flutterTestDriverTestFile),
			});
			assert.equal(noAppConfig, undefined);
			assert.ok(showErrorMessage.calledOnceWithExactly("Could not find a running Flutter app that was instrumented with enableFlutterDriverExtension. Run your instrumented app before running driver tests."));

			// 1 running instrumented app, but no vmServiceUri yet.
			showErrorMessage.resetHistory();
			const session1 = startFakeDebugSession({ id: "driver-1" });
			const dartSession1 = privateApi.debugSessions.find((s) => s.session === session1)!;
			dartSession1.loadedServiceExtensions.push(VmServiceExtension.Driver);

			const uninitialisedAppConfig = await getResolvedDebugConfiguration({
				program: fsPath(flutterTestDriverTestFile),
			});
			assert.equal(uninitialisedAppConfig, undefined);
			assert.ok(showErrorMessage.calledOnceWithExactly("The Flutter app instrumented with enableFlutterDriverExtension is not fully initialised yet."));

			// >1 running instrumented apps.
			showErrorMessage.resetHistory();
			const session2 = startFakeDebugSession({ id: "driver-2" });
			const dartSession2 = privateApi.debugSessions.find((s) => s.session === session2)!;
			dartSession2.loadedServiceExtensions.push(VmServiceExtension.Driver);

			const multipleAppsConfig = await getResolvedDebugConfiguration({
				program: fsPath(flutterTestDriverTestFile),
			});
			assert.equal(multipleAppsConfig, undefined);
			assert.ok(showErrorMessage.calledOnceWithExactly("More than one Flutter app instrumented with enableFlutterDriverExtension is running. Please run only one app before running driver tests."));

			// Remove second session and set vmServiceUri on the first session.
			privateApi.debugCommands.handleDebugSessionEnd(session2);
			dartSession1.vmServiceUri = "ws://127.0.0.1:8181/ws";
			const customRequest = sb.spy(session1, "customRequest");

			const validAppConfig = await getResolvedDebugConfiguration({
				program: fsPath(flutterTestDriverTestFile),
			});
			assert.ok(validAppConfig);
			assert.ok(customRequest.calledOnceWithExactly("hotRestart"));
			assert.equal(validAppConfig.env?.VM_SERVICE_URL, "ws://127.0.0.1:8181/ws");
		});
	});
});

describe("InitialLaunchJsonDebugConfigProvider (Flutter)", () => {
	before("activate", () => activate(null));

	it("returns regular, profile, and release launch configs for Flutter projects", async () => {
		const configs = await privateApi.initialDebugProvider.provideDebugConfigurations!(vs.workspace.workspaceFolders![0]);

		assert.deepStrictEqual(configs, [
			{
				cwd: undefined,
				name: "flutter_hello_world",
				request: "launch",
				type: "dart",
			},
			{
				cwd: undefined,
				flutterMode: "profile",
				name: "flutter_hello_world (profile mode)",
				request: "launch",
				type: "dart",
			},
			{
				cwd: undefined,
				flutterMode: "release",
				name: "flutter_hello_world (release mode)",
				request: "launch",
				type: "dart",
			},
			{
				cwd: "example",
				name: "example",
				request: "launch",
				type: "dart",
			},
			{
				cwd: "example",
				flutterMode: "profile",
				name: "example (profile mode)",
				request: "launch",
				type: "dart",
			},
			{
				cwd: "example",
				flutterMode: "release",
				name: "example (release mode)",
				request: "launch",
				type: "dart",
			},
		]);
	});
});

describe("DynamicDebugConfigProvider (Flutter)", () => {
	before("activate", () => activate(null));

	it("returns dynamic launch configs for Flutter project with devices, modes, test, and integration_test", async () => {
		const dm = privateApi.deviceManager!;
		sb.stub(dm, "getValidDevicesForProject").resolves([emulatedAndroidMobile]);

		const configs = await privateApi.dynamicDebugProvider.provideDebugConfigurations!(vs.workspace.workspaceFolders![0]);

		assert.deepStrictEqual(configs, [
			{
				cwd: undefined,
				name: "flutter_hello_world (Flutter)",
				program: "lib/main.dart",
				request: "launch",
				type: "dart",
			},
			{
				cwd: undefined,
				deviceId: emulatedAndroidMobile.id,
				name: "flutter_hello_world (Flutter Pixel 7)",
				program: "lib/main.dart",
				request: "launch",
				type: "dart",
			},
			{
				cwd: undefined,
				flutterMode: "profile",
				name: "flutter_hello_world (Flutter profile mode)",
				program: "lib/main.dart",
				request: "launch",
				type: "dart",
			},
			{
				cwd: undefined,
				flutterMode: "release",
				name: "flutter_hello_world (Flutter release mode)",
				program: "lib/main.dart",
				request: "launch",
				type: "dart",
			},
			{
				cwd: undefined,
				name: "flutter_hello_world (Flutter Tests)",
				program: "test",
				request: "launch",
				type: "dart",
			},
			{
				cwd: undefined,
				name: "flutter_hello_world (Flutter Integration Tests)",
				program: "integration_test",
				request: "launch",
				type: "dart",
			},
			{
				cwd: "example",
				name: "example (Flutter Tests)",
				program: "test",
				request: "launch",
				type: "dart",
			},
		]);
	});
});
