import { strict as assert } from "assert";
import { ChildProcess } from "child_process";
import { EventEmitter } from "events";
import * as vs from "vscode";
import { commands } from "vscode";
import { DaemonCapabilities } from "../../shared/capabilities/flutter";
import { ExtensionRestartReason, skipAction } from "../../shared/constants";
import * as f from "../../shared/flutter/daemon_interfaces";
import { IAmDisposable, IFlutterDaemon } from "../../shared/interfaces";
import * as processes from "../../shared/processes";
import { UnknownResponse } from "../../shared/services/interfaces";
import { FlutterDeviceManager, PickableDevice } from "../../shared/vscode/device_manager";
import * as vsUtils from "../../shared/vscode/utils";
import { activateWithoutAnalysis, defer, delay, logger, privateApi, sb } from "../helpers";
import { FakeProcessStdIOService } from "../mocks/fake_stdio_service";
import { androidBogusEmulatorId, androidBogusEmulatorName, androidEmulator, androidEmulatorToOverride, customEmulator, customEmulator1, customEmulator2, customEmulators, desktop, emulatedAndroidMobile, emulatediOSMobile, emulatorCreator, physicalAndroidMobile, webChrome, webServer } from "./flutter_test_devices";

// Workaround for @types/sinon being pinned at 5.0.5 (which predates tickAsync) while sinon is ^21.0.1.
// See https://github.com/Dart-Code/Dart-Code/issues/6295.
declare module "sinon" {
	interface SinonFakeTimers {
		tickAsync(ms: number | string): Promise<number>;
	}
}

describe("device_manager", () => {
	let dm: FlutterDeviceManager;
	let daemon: FakeFlutterDaemon;

	beforeEach(() => activateWithoutAnalysis());
	beforeEach(() => {
		privateApi.context.workspaceLastFlutterDeviceId = undefined;
		daemon = new FakeFlutterDaemon();
		// TODO: Tests for custom emulators.
		dm = new FlutterDeviceManager(
			logger,
			daemon,
			{
				flutterCustomEmulators: customEmulators,
				flutterRememberSelectedDevice: true,
				flutterSelectDeviceWhenConnected: true,
				flutterShowEmulators: "local",
				projectSearchDepth: 3,
			},
			privateApi.workspaceContext,
			privateApi.context,
		);
	});

	afterEach(async () => {
		dm.dispose();
		await daemon.dispose();
	});

	it("auto-selects valid devices", async () => {
		assert.equal(dm.currentDevice, undefined);

		// connect a device and ensure it's selected.
		await daemon.connect(physicalAndroidMobile, true);
		assert.deepStrictEqual(dm.currentDevice, physicalAndroidMobile);

		// Connect another and ensure it's changed.
		await daemon.connect(emulatedAndroidMobile, true);
		assert.deepStrictEqual(dm.currentDevice, emulatedAndroidMobile);
	});

	it("generates the correct label for desktop devices", async () => {
		assert.equal(dm.currentDevice, undefined);

		await daemon.connect(desktop, true);
		assert.deepStrictEqual(dm.currentDevice, desktop);
		assert.deepStrictEqual(dm.labelForDevice(dm.currentDevice), desktop.name);
		assert.deepStrictEqual(dm.labelForDevice(dm.currentDevice, { withIcon: true }), "$(device-desktop) " + desktop.name);
	});

	it("generates the correct label for web devices", async () => {
		assert.equal(dm.currentDevice, undefined);

		await daemon.connect(webChrome, true);
		assert.deepStrictEqual(dm.currentDevice, webChrome);
		assert.deepStrictEqual(dm.labelForDevice(dm.currentDevice), webChrome.name);
		assert.deepStrictEqual(dm.labelForDevice(dm.currentDevice, { withIcon: true }), "$(browser) " + webChrome.name);
	});

	it("generates the correct label for Android emulator devices", async () => {
		assert.equal(dm.currentDevice, undefined);

		// connect a device that has an emulator ID and ensure we correctly build
		// it's label (which happens by fetching the emulator list up-front and
		// then looking it up).
		await daemon.connect(emulatedAndroidMobile, true);
		assert.deepStrictEqual(dm.currentDevice, emulatedAndroidMobile);
		assert.deepStrictEqual(dm.labelForDevice(dm.currentDevice), androidEmulator.name);
		assert.deepStrictEqual(dm.labelForDevice(dm.currentDevice, { withIcon: true }), "$(device-mobile) " + androidEmulator.name);
	});

	it("does not include bogus emulators", async () => {
		const rawEmulatorLabels = (await daemon.getEmulators()).map((e) => e.name);
		const emulatorLabels = (await dm.getPickableEmulators(false)).map((e) => e.label);
		assert.deepStrictEqual(rawEmulatorLabels, [
			androidEmulator.name,
			androidBogusEmulatorId.name,
			androidBogusEmulatorName.name,
			androidEmulatorToOverride.name,
		]);
		assert.deepStrictEqual(emulatorLabels, [
			androidEmulator.name,
			customEmulator2.name,
			customEmulator1.name,
		]);
	});

	it("uses the standard device name for iOS simulator devices", async () => {
		assert.equal(dm.currentDevice, undefined);

		// For iOS, we don't use the emulator names since it's just "iOS Simulator"
		// instead of "iPhone X" etc.
		await daemon.connect(emulatediOSMobile, true);
		assert.deepStrictEqual(dm.currentDevice, emulatediOSMobile);
		assert.deepStrictEqual(dm.labelForDevice(dm.currentDevice), emulatediOSMobile.name);
		assert.deepStrictEqual(dm.labelForDevice(dm.currentDevice, { withIcon: true }), "$(device-mobile) " + emulatediOSMobile.name);
	});

	it("includes custom emulators", async () => {
		const emulators = await dm.getPickableEmulators(true);
		const em = emulators.find((e) => e.device.id === customEmulator1.id);

		if (!em)
			throw new Error("Custom emulator was missing");
		if (em.device.type !== "custom-emulator")
			throw new Error("Wrong device type");
		assert.equal(em.alwaysShow, false);
		assert.equal(em.description, "custom emulator");
		assert.equal(em.detail, undefined);
		assert.equal(em.device.id, customEmulator1.id);
		assert.equal(em.device.executable, "echo");
		assert.deepEqual(em.device.args, ["args"]);
		assert.equal(em.device.platformType, undefined);
		assert.equal(em.device.type, "custom-emulator");
		assert.equal(em.label, "$(play) Start My custom emulator");
	});

	it("includes cold boot option for Android emulators only", async () => {
		// Set a daemon version that does not support cold boot
		daemon.capabilities = new DaemonCapabilities("0.6.0");
		let emulators = await dm.getPickableEmulators(true);
		let coldBootable = emulators.filter((e) => e.coldBoot !== undefined && e.coldBoot === true);
		assert.equal(coldBootable.length, 0);

		// Set a daemon version that supports cold boot
		daemon.capabilities = new DaemonCapabilities("0.6.1");
		emulators = await dm.getPickableEmulators(true);
		coldBootable = emulators.filter((e) => e.coldBoot !== undefined && e.coldBoot === true);
		const androidEmulators = emulators.filter((e) => e.device.platformType === "android" && e.device.type === "emulator");
		// Expect that all android emulators have a coldboot version
		assert.equal(coldBootable.length, androidEmulators.length);
		// All cold boot entries should have the type android
		coldBootable.forEach((e) => assert.equal(e.device.platformType, "android"));
	});

	it("overrides real emulators with custom definitions", async () => {
		const emulators = await dm.getPickableEmulators(true);
		const em = emulators.find((e) => e.device.id === customEmulator2.id);

		if (!em)
			throw new Error("Custom emulator was missing");
		if (em.device.type !== "custom-emulator")
			throw new Error("Wrong device type");
		assert.equal(em.alwaysShow, false);
		assert.equal(em.description, "mobile emulator"); // Preserved from base
		assert.equal(em.detail, undefined);
		assert.equal(em.device.id, customEmulator2.id);
		assert.equal(em.device.executable, "echo");
		assert.deepEqual(em.device.args, ["args"]);
		assert.equal(em.device.platformType, "android"); // Preserved from base
		assert.equal(em.device.type, "custom-emulator");
		assert.equal(em.label, "$(play) Start My emulator override");
	});

	it("auto-selects devices if supported platforms are not known", async () => {
		assert.equal(dm.currentDevice, undefined);

		// connect a device without setting it as valid, but still expect
		// it to be selected because without any explicitly marked valid platforms
		// we expect android/ios to still be valid.
		await daemon.connect(physicalAndroidMobile, false);
		assert.deepStrictEqual(dm.currentDevice, physicalAndroidMobile);
	});

	it("does not auto-select invalid devices", async () => {
		// We treat an empty list of platforms as "everything is supported" so we
		// need to have at least one thing in this list for other devices to be
		// considered invalid.
		daemon.supportedPlatforms = ["invalid"];
		assert.equal(dm.currentDevice, undefined);

		// connect a device and ensure it's not selected.
		await daemon.connect(physicalAndroidMobile, false);
		assert.deepStrictEqual(dm.currentDevice, undefined);
	});

	it("un-selects disconnected devices", async () => {
		assert.equal(dm.currentDevice, undefined);
		await daemon.connect(emulatedAndroidMobile, true);
		await daemon.connect(physicalAndroidMobile, true);

		assert.deepStrictEqual(dm.currentDevice, physicalAndroidMobile);
		await daemon.disconnect(physicalAndroidMobile);
		assert.deepStrictEqual(dm.currentDevice, emulatedAndroidMobile);
		await daemon.disconnect(emulatedAndroidMobile);
		assert.deepStrictEqual(dm.currentDevice, undefined);
	});

	it("will auto-select a valid non-ephemeral device if there is no other device", async () => {
		assert.deepStrictEqual(dm.currentDevice, undefined);

		await daemon.connect(desktop, true);
		assert.deepStrictEqual(dm.currentDevice, desktop);
	});

	it("will not auto-select an invalid non-ephemeral device even if there is no other device", async () => {
		// We treat an empty list of platforms as "everything is supported" so we
		// need to have at least one thing in this list for other devices to be
		// considered invalid.
		daemon.supportedPlatforms = ["invalid"];
		assert.deepStrictEqual(dm.currentDevice, undefined);

		await daemon.connect(desktop, false);
		assert.deepStrictEqual(dm.currentDevice, undefined);
	});

	it("will not auto-select a non-ephemeral device if there another device", async () => {
		await daemon.connect(physicalAndroidMobile, true);
		assert.deepStrictEqual(dm.currentDevice, physicalAndroidMobile);

		// Connecting desktop does not change the selected device.
		await daemon.connect(desktop, true);
		assert.deepStrictEqual(dm.currentDevice, physicalAndroidMobile);
	});

	it("will auto-select a non-ephemeral device if it is preferred", async () => {
		await daemon.enablePlatform(desktop.platformType); // Ensure Desktop is valid before anything is cached.
		await daemon.connect(physicalAndroidMobile, true);
		assert.deepStrictEqual(dm.currentDevice, physicalAndroidMobile);

		// Connecting desktop does change the selected device.
		privateApi.context.workspaceLastFlutterDeviceId = desktop.id;
		await daemon.connect(desktop, true);
		assert.deepStrictEqual(dm.currentDevice, desktop);
	});

	it("shows unsupported platforms, runs flutter create, and selects", async () => {
		await daemon.connect(desktop, false);
		const devices = dm.getPickableDevices(["android"], undefined, undefined);
		const d = devices.find((e) => "device" in e && e.device.type === "platform-enabler" && e.device.platformType === "macos") as PickableDevice | undefined;

		if (!d)
			throw new Error("macos platform enabler was missing");

		assert.equal(d.label, `Enable macos for this project`);

		const flutterCreateCommand = sb.stub(commands, "executeCommand")
			.callThrough()
			.withArgs("_flutter.create").resolves();

		await dm.selectDevice(d);

		// Check we called the command.
		assert.equal(flutterCreateCommand.called, true);

		// Also ensure we selected this device afterwards.
		assert.deepStrictEqual(dm.currentDevice, desktop);
	});

	it("tryGetSupportedPlatformTypes returns platformTypes", async () => {
		daemon.supportedPlatforms = ["a", "b"];
		const platforms = await dm.tryGetSupportedPlatformTypes("fake");
		assert.deepStrictEqual(platforms, ["a", "b"]);
	});

	it("handles errors in tryGetSupportedPlatformTypes", async () => {
		daemon.supportedPlatforms = ["a", "b"];
		const platforms = await dm.tryGetSupportedPlatformTypes(""); // throws because falsy path
		assert.equal(platforms, undefined);
	});

	it("handles unresponsive tryGetSupportedPlatformTypes", async () => {
		dm.unresponsiveTimeoutPeriodSeconds = 0.2;
		daemon.supportedPlatforms = ["a", "b"];
		daemon.supportedPlatformsDelaySeconds = 10;
		const platforms = await dm.tryGetSupportedPlatformTypes("fake");
		assert.equal(platforms, undefined);
	});

	it("fuzzy matches devices by ID", async () => {
		const matchExactId = { id: "exact-id-match", name: "bad name", type: "device" } as f.Device;
		const matchExactName = { id: "bad-id-1", name: "exact-name-match", type: "device" } as f.Device;
		const matchIdStartsWith = { id: "starts-with-id-match", name: "bad name", type: "device" } as f.Device;
		const matchNameStartsWith = { id: "bad-id-2", name: "starts-with-name-match", type: "device" } as f.Device;
		const matchIdContains = { id: "bad-contains-id-match-bad", name: "bad name", type: "device" } as f.Device;
		const matchNameContains = { id: "bad-id-3", name: "bad-contains-name-match-bad", type: "device" } as f.Device;

		await daemon.connect(matchExactId, false);
		await daemon.connect(matchExactName, false);
		await daemon.connect(matchIdStartsWith, false);
		await daemon.connect(matchNameStartsWith, false);
		await daemon.connect(matchIdContains, false);
		await daemon.connect(matchNameContains, false);

		assert.equal(dm.findBestDevice("EXACT-ID-MATCH")?.id, matchExactId.id);
		assert.equal(dm.findBestDevice("Exact-Name-Match")?.id, matchExactName.id);
		assert.equal(dm.findBestDevice("STARTS-WITH")?.id, matchIdStartsWith.id);
		assert.equal(dm.findBestDevice("Starts-With-Name")?.id, matchNameStartsWith.id);
		assert.equal(dm.findBestDevice("CONTAINS-ID")?.id, matchIdContains.id);
		assert.equal(dm.findBestDevice("Contains-Name")?.id, matchNameContains.id);
	});

	it("fuzzy matching prefers ID over name", async () => {
		const matchIdContains2 = { id: "xx-fuzzy-match", name: "bad name", type: "device" } as f.Device;
		const matchNameContains2 = { id: "bad-id-4", name: "xx-fuzzy-match", type: "device" } as f.Device;

		await daemon.connect(matchIdContains2, false);
		await daemon.connect(matchNameContains2, false);

		assert.equal(dm.findBestDevice("FUZZY-MATCH")?.id, matchIdContains2.id);
	});

	it("fuzzy matches devices by Emulator ID", async () => {
		const matchExactId = { id: "d1", emulatorId: "exact-id-match", name: "bad name", type: "device" } as f.Device;
		const matchIdStartsWith = { id: "d3", emulatorId: "starts-with-id-match", name: "bad name", type: "device" } as f.Device;
		const matchIdContains = { id: "d5", emulatorId: "xx-contains-id-match", name: "bad name", type: "device" } as f.Device;

		await daemon.connect(matchExactId, false);
		await daemon.connect(matchIdStartsWith, false);
		await daemon.connect(matchIdContains, false);

		assert.equal(dm.findBestEmulatorDevice("EXACT-ID-MATCH")?.id, matchExactId.id);
		assert.equal(dm.findBestEmulatorDevice("STARTS-WITH")?.id, matchIdStartsWith.id);
		assert.equal(dm.findBestEmulatorDevice("CONTAINS-ID")?.id, matchIdContains.id);
	});

	it("fuzzy matches emulators by ID and Name", async () => {
		const matchExactId = { id: "exact-match", name: "bad name", category: "mobile", platformType: "android" } as f.FlutterEmulator;
		const matchExactName = { id: "bad-id-1", name: "exact-match", category: "mobile", platformType: "android" } as f.FlutterEmulator;
		const matchIdStartsWith = { id: "exact-match-starts-with", name: "bad name", category: "mobile", platformType: "android" } as f.FlutterEmulator;
		const matchNameStartsWith = { id: "bad-id-2", name: "exact-match-starts-with", category: "mobile", platformType: "android" } as f.FlutterEmulator;
		const matchIdContains = { id: "contains-exact-match-contains", name: "bad name", category: "mobile", platformType: "android" } as f.FlutterEmulator;
		const matchNameContains = { id: "bad-id-3", name: "contains-exact-match-contains", category: "mobile", platformType: "android" } as f.FlutterEmulator;

		daemon.emulators = [matchExactId, matchExactName, matchIdStartsWith, matchNameStartsWith, matchIdContains, matchNameContains];
		assert.equal((await dm.findBestEmulator("EXACT-MATCH"))?.id, matchExactId.id);

		daemon.emulators = [matchExactName, matchIdStartsWith, matchNameStartsWith, matchIdContains, matchNameContains];
		assert.equal((await dm.findBestEmulator("Exact-Match"))?.id, matchExactName.id);

		daemon.emulators = [matchIdStartsWith, matchNameStartsWith, matchIdContains, matchNameContains];
		assert.equal((await dm.findBestEmulator("EXACT-MATCH"))?.id, matchIdStartsWith.id);

		daemon.emulators = [matchNameStartsWith, matchIdContains, matchNameContains];
		assert.equal((await dm.findBestEmulator("Exact-Match"))?.id, matchNameStartsWith.id);

		daemon.emulators = [matchIdContains, matchNameContains];
		assert.equal((await dm.findBestEmulator("EXACT-MATCH"))?.id, matchIdContains.id);

		daemon.emulators = [matchNameContains];
		assert.equal((await dm.findBestEmulator("Exact-Match"))?.id, matchNameContains.id);
	});

	it("invokes runIfNoDevices after timeout when no devices are connected", () => {
		const clock = sb.useFakeTimers({ toFake: ["setTimeout"] });
		defer("Restore fake timers", () => clock.restore());

		let runIfNoDevicesCalled = 0;
		const dmWithCallback = new FlutterDeviceManager(
			logger,
			daemon,
			{
				flutterCustomEmulators: [],
				flutterRememberSelectedDevice: true,
				flutterSelectDeviceWhenConnected: true,
				flutterShowEmulators: "local",
				projectSearchDepth: 3,
			},
			privateApi.workspaceContext,
			privateApi.context,
			() => runIfNoDevicesCalled++,
		);
		defer("Dispose dmWithCallback", () => dmWithCallback.dispose());

		// Advance the 10-second timer registered in the constructor when no devices exist.
		clock.tick(10000);
		assert.equal(runIfNoDevicesCalled, 1);
	});

	it("does not invoke runIfNoDevices after timeout when a device is connected", async () => {
		const clock = sb.useFakeTimers({ toFake: ["setTimeout"] });
		defer("Restore fake timers", () => clock.restore());

		let runIfNoDevicesCalled = 0;
		const dmWithDevice = new FlutterDeviceManager(
			logger,
			daemon,
			{
				flutterCustomEmulators: [],
				flutterRememberSelectedDevice: true,
				flutterSelectDeviceWhenConnected: true,
				flutterShowEmulators: "local",
				projectSearchDepth: 3,
			},
			privateApi.workspaceContext,
			privateApi.context,
			() => runIfNoDevicesCalled++,
		);
		defer("Dispose dmWithDevice", () => dmWithDevice.dispose());

		await daemon.connect(physicalAndroidMobile, true);
		clock.tick(10000);
		assert.equal(runIfNoDevicesCalled, 0);
	});

	it("does not auto-select a newly connected device when current device is preferred", async () => {
		await daemon.connect(physicalAndroidMobile, true);
		assert.deepStrictEqual(dm.currentDevice, physicalAndroidMobile);

		// Mark current device as preferred.
		privateApi.context.workspaceLastFlutterDeviceId = physicalAndroidMobile.id;

		// Connect another ephemeral device and verify currentDevice is not changed.
		await daemon.connect(emulatedAndroidMobile, true);
		assert.deepStrictEqual(dm.currentDevice, physicalAndroidMobile);
	});

	it("auto-selects web-server over non-ephemeral device when not running locally, and switches from web-server to chrome", async () => {
		sb.stub(vsUtils, "isRunningLocally").value(false);

		await daemon.enablePlatform("macos");
		await daemon.enablePlatform("web");
		await daemon.connect(desktop, true);
		assert.deepStrictEqual(dm.currentDevice, desktop);

		// In a remote workspace, web-server should be selected over a non-ephemeral desktop device.
		await daemon.connect(webServer, true);
		assert.deepStrictEqual(dm.currentDevice, webServer);

		// When chrome connects while web-server is selected (and not preferred), it should switch to chrome.
		await daemon.connect(webChrome, true);
		assert.deepStrictEqual(dm.currentDevice, webChrome);
	});

	it("logs an error when getEmulators fails in constructor or directly", async () => {
		const errorStub = sb.stub(logger, "error");
		sb.stub(daemon, "getEmulators").rejects("daemon getEmulators failed");

		const emulators = await dm.getPickableEmulators(true);
		assert.deepStrictEqual(emulators, []);
		assert.equal(errorStub.called, true);
	});

	it("getPickableEmulators respects flutterShowEmulators never and local when remote, and includes emulator-creator", async () => {
		const dmNever = new FlutterDeviceManager(
			logger,
			daemon,
			{
				flutterCustomEmulators: [],
				flutterRememberSelectedDevice: false,
				flutterSelectDeviceWhenConnected: true,
				flutterShowEmulators: "never",
				projectSearchDepth: 3,
			},
			privateApi.workspaceContext,
			privateApi.context,
		);
		defer("Dispose dmNever", () => dmNever.dispose());

		assert.deepStrictEqual(await dmNever.getPickableEmulators(true), []);
		await dmNever.selectDevice({ device: physicalAndroidMobile, label: physicalAndroidMobile.name });
		assert.equal(privateApi.context.workspaceLastFlutterDeviceId, undefined);

		// When flutterShowEmulators is "local" and isRunningLocally is false, returns [].
		sb.stub(vsUtils, "isRunningLocally").value(false);
		assert.deepStrictEqual(await dm.getPickableEmulators(true), []);

		// Restore isRunningLocally and enable canCreateEmulators.
		sb.stub(vsUtils, "isRunningLocally").value(true);
		daemon.capabilities = new DaemonCapabilities("0.4.0"); // Supports canCreateEmulators.
		daemon.emulators = [
			// Empty name and category test falling back to the emulator ID for the label and "mobile" for the category description,
			// and "ios" tests using "simulator" instead of "emulator".
			{ id: "fallback_id_only", name: "", category: "", platformType: "ios" },
			// "WARN |" and "ERR |" prefixes (like "INFO |" in https://github.com/Dart-Code/Dart-Code/issues/5052) are bogus log
			// messages from the Android emulator tool that should be filtered out.
			{ id: "warn_bogus", name: "WARN | bogus warning", category: "mobile", platformType: "android" },
			{ id: "err_bogus", name: "ERR | bogus error", category: "mobile", platformType: "android" },
		];
		const pickableAsEmulators = await dm.getPickableEmulators(true, ["android", "ios"]);
		const iosSim = pickableAsEmulators.find((e) => e.device.id === "fallback_id_only");
		assert.ok(iosSim);
		assert.equal(iosSim.description, "mobile simulator");
		assert.equal(iosSim.label, "$(play) Start fallback_id_only");

		const creator = pickableAsEmulators.find((e) => e.device.type === "emulator-creator");
		assert.ok(creator);
		assert.equal(creator.label, "$(plus) Create Android emulator");
	});

	it("getPickableDevices builds Available Devices, Offline Emulators (filtering running), and Other Available Platforms", async () => {
		await daemon.connect({ ...physicalAndroidMobile, category: undefined, platform: "" }, true);
		await daemon.connect({ ...emulatedAndroidMobile, category: undefined }, true);
		// Connect the mocked desktop device (platformType: "macos") without marking its platform as supported
		// so it appears under "Other Available Platforms" regardless of the host OS running the test.
		await daemon.connect(desktop, false);

		const offlineEmulatorPickable: PickableDevice = {
			device: customEmulator,
			label: "Start Offline Emulator",
		};
		const runningEmulatorPickable: PickableDevice = {
			device: androidEmulator,
			label: "Start Running Emulator",
		};

		// When only the already-running emulator is provided, Offline Emulators section is omitted.
		const itemsWithoutOffline = dm.getPickableDevices(["android"], [runningEmulatorPickable], "/project");
		assert.equal(itemsWithoutOffline.some((i) => i.label === "Offline Emulators"), false);

		// When an offline emulator is also present, Offline Emulators section is included with only the offline one.
		const items = dm.getPickableDevices(["android"], [runningEmulatorPickable, offlineEmulatorPickable], "/project");
		const labels = items.map((i) => i.label);
		assert.deepStrictEqual(labels, [
			"Available Devices",
			androidEmulator.name,
			physicalAndroidMobile.name,
			"Offline Emulators",
			"Start Offline Emulator",
			"Other Available Platforms",
			`Enable ${desktop.platformType} for this project`,
		]);

		const currentPickable = items[1] as PickableDevice;
		assert.equal(currentPickable.detail, "Current Device");
		assert.equal(currentPickable.description, `${emulatedAndroidMobile.id} - ${emulatedAndroidMobile.platform}`);

		const otherPickable = items[2] as PickableDevice;
		assert.equal(otherPickable.detail, undefined);
		assert.equal(otherPickable.description, `${physicalAndroidMobile.id} - `);
	});

	it("showDevicePicker updates items when devices change and selects chosen device or returns undefined on dismiss", async () => {
		daemon.capabilities = new DaemonCapabilities("0.7.0"); // providesPlatformTypes = true.
		await daemon.connect(physicalAndroidMobile, true);

		let acceptHandler: (() => void) | undefined;
		let hideHandler: (() => void) | undefined;
		let shownQuickPick: vs.QuickPick<PickableDevice> | undefined;

		sb.stub(vs.window, "createQuickPick").callsFake(() => {
			const qp = {
				busy: false,
				dispose: sb.stub(),
				ignoreFocusOut: false,
				items: [] as PickableDevice[],
				onDidAccept: (cb: () => void) => {
					acceptHandler = cb;
					return { dispose: () => undefined };
				},
				onDidHide: (cb: () => void) => {
					hideHandler = cb;
					return { dispose: () => undefined };
				},
				placeholder: undefined as string | undefined,
				selectedItems: [] as PickableDevice[],
				show: () => {
					shownQuickPick = qp;
				},
			} as unknown as vs.QuickPick<PickableDevice>;
			return qp;
		});

		// Start picker without supportedTypes so it queries getSupportedPlatformsForWorkspace().
		const pickerPromise = dm.showDevicePicker(undefined, undefined);

		// Wait until quickPick.show() has been called.
		while (!shownQuickPick)
			await new Promise((resolve) => setImmediate(resolve));

		// Connect and disconnect a device while picker is open to trigger dynamic list updates.
		await daemon.connect(emulatedAndroidMobile, true);
		assert.equal(shownQuickPick.items.some((i) => i.device?.id === emulatedAndroidMobile.id), true);

		await daemon.disconnect(physicalAndroidMobile);
		assert.equal(shownQuickPick.items.some((i) => i.device?.id === physicalAndroidMobile.id), false);

		// Select emulatedAndroidMobile and accept.
		const targetItem = shownQuickPick.items.find((i) => i.device?.id === emulatedAndroidMobile.id)!;
		shownQuickPick.selectedItems = [targetItem];
		acceptHandler!();

		const selected = await pickerPromise;
		assert.deepStrictEqual(selected, emulatedAndroidMobile);

		// Also test dismissing the picker (and getPickableEmulators rejecting after dismissal).
		shownQuickPick = undefined;
		let rejectEmulators: ((e: Error) => void) | undefined;
		sb.stub(dm, "getPickableEmulators").returns(new Promise((_, reject) => {
			rejectEmulators = reject;
		}));

		const dismissPromise = dm.showDevicePicker(["android"], undefined);
		while (!shownQuickPick)
			await new Promise((resolve) => setImmediate(resolve));

		hideHandler!();
		const dismissedResult = await dismissPromise;
		assert.equal(dismissedResult, undefined);

		// Reject getPickableEmulators after quickPickIsValid is false to cover !quickPickIsValid and catch block.
		rejectEmulators!(new Error("late emulator failure"));
		await new Promise((resolve) => setImmediate(resolve));
	});

	it("selectDeviceById and selectDeviceByPlatformType handle valid, invalid, and undefined inputs", async () => {
		await daemon.connect(physicalAndroidMobile, true);
		assert.deepStrictEqual(dm.currentDevice, physicalAndroidMobile);

		// selectDeviceById(undefined) clears currentDevice.
		assert.equal(await dm.selectDeviceById(undefined), true);
		assert.equal(dm.currentDevice, undefined);

		// selectDeviceById with unknown ID returns false.
		assert.equal(await dm.selectDeviceById("unknown-id"), false);
		assert.equal(dm.currentDevice, undefined);

		// selectDeviceById with valid ID selects the device and returns true.
		assert.equal(await dm.selectDeviceById(physicalAndroidMobile.id), true);
		assert.deepStrictEqual(dm.currentDevice, physicalAndroidMobile);

		// selectDeviceByPlatformType with unknown platformType returns false.
		assert.equal(await dm.selectDeviceByPlatformType("fuchsia"), false);

		// selectDeviceByPlatformType with valid platformType selects the device and returns true.
		await daemon.connect(desktop, true);
		assert.equal(await dm.selectDeviceByPlatformType("macos"), true);
		assert.deepStrictEqual(dm.currentDevice, desktop);
	});

	it("selectDevice handles emulator-creator, emulator, custom-emulator, and platform-enabler failure", async () => {
		await daemon.connect(physicalAndroidMobile, true);

		const createEmulatorStub = sb.stub(dm, "createEmulator").resolves(true);
		const launchEmulatorStub = sb.stub(dm, "launchEmulator").resolves(true);
		const launchCustomEmulatorStub = sb.stub(dm, "launchCustomEmulator").resolves(true);

		// 1. emulator-creator
		await dm.selectDevice({
			device: emulatorCreator,
			label: "Create Android emulator",
		});
		assert.equal(createEmulatorStub.calledOnce, true);

		// Next connected device should be remembered because rememberNextAddedDevice was set.
		await daemon.connect(emulatedAndroidMobile, true);
		assert.equal(privateApi.context.workspaceLastFlutterDeviceId, emulatedAndroidMobile.id);

		// 2. emulator (without and with coldBoot)
		await dm.selectDevice({ device: androidEmulator, label: androidEmulator.name });
		assert.equal(launchEmulatorStub.calledOnceWithExactly(androidEmulator, false), true);

		await dm.selectDevice({ device: androidEmulator, label: `${androidEmulator.name} (cold)`, coldBoot: true });
		assert.equal(launchEmulatorStub.calledWithExactly(androidEmulator, true), true);

		// 3. custom-emulator
		await dm.selectDevice({ device: customEmulator, label: customEmulator.name });
		assert.equal(launchCustomEmulatorStub.calledOnceWithExactly(customEmulator), true);

		// 4. platform-enabler when enablePlatformType returns false
		sb.stub(dm, "enablePlatformType").resolves(false);
		const enablerRes = await dm.selectDevice({
			device: { type: "platform-enabler", platformType: "linux", projectRoot: "/proj" },
			label: "Enable linux",
		});
		assert.equal(enablerRes, false);
	});

	it("enablePlatformType enables platform globally, prompts to reload, and fires change events", async () => {
		await daemon.connect(desktop, false);

		sb.stub(daemon, "checkIfPlatformGloballyDisabled").resolves(true);
		const enableGloballySpy = sb.spy(daemon, "enablePlatformGlobally");
		const executeCommandStub = sb.stub(commands, "executeCommand").callThrough();
		executeCommandStub.withArgs("_flutter.create").resolves();
		executeCommandStub.withArgs("_dart.reloadExtension").resolves();

		// Case 1: User clicks "Reload" on the prompt.
		const showInfoStub = sb.stub(vs.window, "showInformationMessage")
			.withArgs("You must reload after enabling a new platform", "Reload", skipAction);
		showInfoStub.resolves("Reload");
		const resReload = await dm.enablePlatformType("macos", "/path/to/pkg");
		assert.equal(resReload, true);
		assert.equal(enableGloballySpy.calledOnceWithExactly("macos"), true);
		assert.equal(executeCommandStub.calledWith("_flutter.create", { platform: "macos", packagePath: "/path/to/pkg" }), true);
		assert.equal(executeCommandStub.calledWithExactly("_dart.reloadExtension", ExtensionRestartReason.NewPlatformEnabledPrompt), true);

		// Case 2: User clicks skipAction -> clears cache and fires onDeviceChanged and onDevicesChanged.
		showInfoStub.resolves(skipAction);
		await daemon.connect(physicalAndroidMobile, true);
		const changedDevices: f.Device[] = [];
		let devicesChangedCount = 0;
		const sub1 = dm.onDeviceChanged((d) => changedDevices.push(d));
		const sub2 = dm.onDevicesChanged(() => devicesChangedCount++);
		defer("Dispose subscriptions", () => {
			sub1.dispose();
			sub2.dispose();
		});
		const resSkip = await dm.enablePlatformType("macos", "/path/to/pkg");
		assert.equal(resSkip, true);
		assert.deepStrictEqual(changedDevices, [desktop]);
		assert.equal(devicesChangedCount, 1);
	});

	it("waitForBestDevice returns immediately when present or polls until connected or timeout", async () => {
		const clock = sb.useFakeTimers({ toFake: ["setTimeout"] });
		defer("Restore fake timers", () => clock.restore());

		const findBestDeviceSpy = sb.spy(dm, "findBestDevice");

		// Not yet connected -> polls every 100ms until connected.
		const waitPromise = dm.waitForBestDevice(physicalAndroidMobile.id, 500);
		// Advance one 100ms poll interval, then connect the device.
		await clock.tickAsync(100);
		await daemon.connect(physicalAndroidMobile, true);
		// Advance the next 100ms poll interval so waitForBestDevice sees the newly connected device.
		await clock.tickAsync(100);
		const foundAfterPoll = await waitPromise;
		assert.deepStrictEqual(foundAfterPoll, physicalAndroidMobile);

		// Already connected -> returns immediately without polling.
		findBestDeviceSpy.resetHistory();
		const foundImmediately = await dm.waitForBestDevice(physicalAndroidMobile.id, 500);
		assert.deepStrictEqual(foundImmediately, physicalAndroidMobile);
		assert.equal(findBestDeviceSpy.callCount, 1);

		// Never connects -> returns undefined after the full 200ms timeout (2 * 100ms poll intervals).
		const notFoundPromise = dm.waitForBestDevice("never-connects", 200);
		await clock.tickAsync(200);
		const notFound = await notFoundPromise;
		assert.equal(notFound, undefined);
	});

	it("sorts devices by name and by current device, and gets valid devices for project", async () => {
		const devB: f.Device = { ...physicalAndroidMobile, id: "dev-b", name: "B Device" };
		const devA: f.Device = { ...physicalAndroidMobile, id: "dev-a", name: "A Device" };
		const devC: f.Device = { ...desktop, id: "dev-c", name: "C Device" };

		await daemon.connect(devB, true);
		await daemon.connect(devA, true);
		await daemon.connect(devC, false);

		// Select devB so it is currentDevice.
		await dm.selectDeviceById(devB.id);

		assert.deepStrictEqual(dm.getDevicesSortedByCurrentAndName().map((d) => d.name), ["B Device", "A Device", "C Device"]);
		assert.deepStrictEqual(dm.getDevicesSortedByName().map((d) => d.name), ["A Device", "B Device", "C Device"]);

		// getValidDevicesForProject when providesPlatformTypes is false returns all devices.
		daemon.capabilities = DaemonCapabilities.empty;
		const allValid = await dm.getValidDevicesForProject("fake");
		assert.equal(allValid.length, 3);

		// getValidDevicesForProject when providesPlatformTypes is true filters by supported platforms.
		daemon.capabilities = new DaemonCapabilities("0.7.0");
		daemon.supportedPlatforms = ["android"];
		const androidOnly = await dm.getValidDevicesForProject("fake");
		assert.deepStrictEqual(androidOnly.map((d) => d.id), ["dev-b", "dev-a"]);
	});

	it("handles forceFlutterWorkspace, tryGetSupportedPlatformTypes errors, and cache expiry in getSupportedPlatformsForWorkspace", async () => {
		const clock = sb.useFakeTimers({ toFake: ["setTimeout"] });
		defer("Restore fake timers", () => clock.restore());

		// Test legacy platforms array and empty response in tryGetSupportedPlatformTypes.
		const getSupportedStub = sb.stub(daemon, "getSupportedPlatforms");
		getSupportedStub.resolves({ platforms: ["linux"], platformTypes: undefined });
		assert.deepStrictEqual(await dm.tryGetSupportedPlatformTypes("fake"), ["linux"]);
		getSupportedStub.resolves({ platformTypes: undefined });
		assert.deepStrictEqual(await dm.tryGetSupportedPlatformTypes("fake"), []);

		// Test forceFlutterWorkspace = true and error handling when tryGetSupportedPlatformTypes rejects.
		sb.stub(privateApi.workspaceContext, "config").value({ ...privateApi.workspaceContext.config, forceFlutterWorkspace: true });
		const tryGetStub = sb.stub(dm, "tryGetSupportedPlatformTypes");
		tryGetStub.rejects(new Error("unexpected failure"));

		dm.shortCacheForSupportedPlatforms = undefined;
		const platformsOnError = await dm.getSupportedPlatformsForWorkspace();
		assert.deepStrictEqual(platformsOnError, []);
		assert.notEqual(dm.shortCacheForSupportedPlatforms, undefined);

		// Advance the 10-second cache expiration timer and verify it clears the cache.
		clock.tick(10000);
		assert.equal(dm.shortCacheForSupportedPlatforms, undefined);

		// Also test when tryGetSupportedPlatformTypes returns undefined.
		tryGetStub.resolves(undefined);
		const platformsOnUndefined = await dm.getSupportedPlatformsForWorkspace();
		assert.deepStrictEqual(platformsOnUndefined, []);
	});

	it("updates statusBarItem text and tooltip for various device and support counts", async () => {
		daemon.supportedPlatforms = ["android"];
		dm.shortCacheForSupportedPlatforms = undefined;

		// 1 supported, 1 unsupported -> "(1 supported for workspace)"
		await daemon.connect(physicalAndroidMobile, false);
		await daemon.connect(desktop, false);
		await dm.updateStatusBar();
		assert.equal(dm.statusBarItem.tooltip, "2 Devices Connected (1 supported for workspace)");

		// 2 supported, 1 unsupported -> "(2 supported for workspace)"
		await daemon.connect(emulatedAndroidMobile, false);
		await dm.updateStatusBar();
		assert.equal(dm.statusBarItem.tooltip, "3 Devices Connected (2 supported for workspace)");
	});

	it("promptForAndLaunchEmulator handles early return, empty emulators, device connection cancellation, and launching", async () => {
		// 1. Returns true early if allowAutomaticSelection && currentDevice.
		await daemon.connect(physicalAndroidMobile, true);
		assert.equal(await dm.promptForAndLaunchEmulator(true), true);

		// Clear currentDevice.
		await dm.selectDeviceById(undefined);

		// 2. Returns false when no emulators are available.
		const getPickableStub = sb.stub(dm, "getPickableEmulators");
		getPickableStub.onFirstCall().resolves([]);
		assert.equal(await dm.promptForAndLaunchEmulator(), false);

		// 3. Cancels quick-pick when a real device is connected while waiting, and returns true because currentDevice is now set.
		const emuItem: PickableDevice = {
			device: androidEmulator,
			label: androidEmulator.name,
		};
		getPickableStub.resolves([emuItem]);

		const showQuickPickStub = sb.stub(vs.window, "showQuickPick");
		showQuickPickStub.onFirstCall().callsFake(async (_items, _options, token) => {
			let cancelled = false;
			token?.onCancellationRequested(() => cancelled = true);
			await daemon.connect(physicalAndroidMobile, true);
			assert.equal(cancelled, true);
			return undefined;
		});
		assert.equal(await dm.promptForAndLaunchEmulator(false), true);

		// 4. User cancels quick-pick with no device connected -> returns false.
		await daemon.disconnect(physicalAndroidMobile);
		showQuickPickStub.onSecondCall().resolves(undefined);
		assert.equal(await dm.promptForAndLaunchEmulator(false), false);

		// 5. Dispatches to createEmulator, launchEmulator, and launchCustomEmulator.
		const createEmuStub = sb.stub(dm, "createEmulator").resolves(true);
		const launchEmuStub = sb.stub(dm, "launchEmulator").resolves(true);
		const launchCustomEmuStub = sb.stub(dm, "launchCustomEmulator").resolves(true);

		const creatorItem: PickableDevice = {
			device: emulatorCreator,
			label: "Create Android emulator",
		};
		showQuickPickStub.onThirdCall().resolves(creatorItem);
		assert.equal(await dm.promptForAndLaunchEmulator(false), true);
		assert.equal(createEmuStub.calledOnce, true);

		showQuickPickStub.onCall(3).resolves(emuItem);
		assert.equal(await dm.promptForAndLaunchEmulator(false), true);
		assert.equal(launchEmuStub.calledOnceWithExactly(androidEmulator, false), true);

		const customItem: PickableDevice = {
			device: customEmulator,
			label: customEmulator.name,
		};
		showQuickPickStub.onCall(4).resolves(customItem);
		assert.equal(await dm.promptForAndLaunchEmulator(false), true);
		assert.equal(launchCustomEmuStub.calledOnceWithExactly(customEmulator), true);
	});

	it("createEmulator launches created emulator on success and shows error on failure", async () => {
		const createStub = sb.stub(daemon, "createEmulator");
		const launchStub = sb.stub(dm, "launchEmulator").resolves(true);
		const showErrorStub = sb.stub(vs.window, "showErrorMessage").resolves(undefined);

		// Success path.
		createStub.onFirstCall().resolves({ success: true, emulatorName: "new_avd", error: "" });
		const successRes = await dm.createEmulator();
		assert.equal(successRes, true);
		assert.equal(launchStub.calledOnceWithExactly({ id: "new_avd", name: "new_avd" }, false), true);

		// Failure path.
		createStub.onSecondCall().resolves({ success: false, emulatorName: "", error: "Failed to create AVD" });
		const failRes = await dm.createEmulator();
		assert.equal(failRes, false);
		assert.equal(showErrorStub.calledOnceWithExactly("Failed to create AVD"), true);
	});

	it("launchEmulator waits for emulator device to connect or shows error on timeout", async () => {
		const clock = sb.useFakeTimers({ toFake: ["setTimeout"] });
		defer("Restore fake timers", () => clock.restore());

		const launchDaemonStub = sb.stub(daemon, "launchEmulator").resolves();
		const showErrorStub = sb.stub(vs.window, "showErrorMessage").resolves(undefined);

		// Start launching the emulator (which polls every 500ms up to 120 times, then waits 1000ms after connecting).
		const launchPromise = dm.launchEmulator(androidEmulator, true);
		// Advance one 500ms poll interval while no device is connected.
		await clock.tickAsync(500);
		// Connect the emulator device, then advance the next 500ms poll interval plus the 1000ms post-connect delay.
		await daemon.connect(emulatedAndroidMobile, true);
		await clock.tickAsync(500 + 1000);
		const launched = await launchPromise;
		assert.equal(launched, true);
		assert.equal(launchDaemonStub.calledOnceWithExactly(androidEmulator.id, true), true);
		assert.deepStrictEqual(dm.currentDevice, emulatedAndroidMobile);

		// Disconnect and verify that if the emulator never connects within 60s (120 * 500ms), an error is shown.
		await daemon.disconnect(emulatedAndroidMobile);
		const timeoutPromise = dm.launchEmulator(androidEmulator, false);
		await clock.tickAsync(120 * 500);
		const timedOut = await timeoutPromise;
		assert.equal(timedOut, false);
		assert.equal(showErrorStub.calledOnce, true);
		assert.equal((showErrorStub.firstCall.args[0] as string).includes("Emulator didn't connect within 60 seconds"), true);
	});

	it("launchCustomEmulator handles device connection, non-zero exit code, and timeout", async () => {
		const clock = sb.useFakeTimers({ toFake: ["setTimeout"] });
		defer("Restore fake timers", () => clock.restore());

		const createFakeProc = (exitCode: number | null = null) => Object.assign(new EventEmitter(), {
			exitCode,
			pid: 12345,
			stderr: new EventEmitter(),
			stdout: new EventEmitter(),
		}) as ChildProcess;

		const safeSpawnStub = sb.stub(processes, "safeSpawn");
		const showErrorStub = sb.stub(vs.window, "showErrorMessage").resolves(undefined);

		// 1. Device connects while polling (500ms poll interval + 1000ms post-connect delay) -> returns true.
		safeSpawnStub.onFirstCall().returns(createFakeProc(null));
		const customEmuNoArgs = { ...customEmulator, args: undefined, executable: "~/bin/emu" };
		const connectPromise = dm.launchCustomEmulator(customEmuNoArgs);
		await daemon.connect(emulatedAndroidMobile, true);
		await clock.tickAsync(500 + 1000);
		const resConnected = await connectPromise;
		assert.equal(resConnected, true);

		// 2. Process exits with non-zero code on first 500ms poll -> shows error and returns false.
		await daemon.disconnect(emulatedAndroidMobile);
		safeSpawnStub.onSecondCall().returns(createFakeProc(42));
		const exitErrorPromise = dm.launchCustomEmulator(customEmuNoArgs);
		await clock.tickAsync(500);
		const resExitError = await exitErrorPromise;
		assert.equal(resExitError, false);
		assert.equal((showErrorStub.firstCall.args[0] as string).includes("Exit code 42"), true);

		// 3. Process exits with 0 but device never connects within 60s (120 * 500ms) -> times out and returns false.
		safeSpawnStub.onThirdCall().returns(createFakeProc(0));
		const timeoutPromise = dm.launchCustomEmulator(customEmulator);
		await clock.tickAsync(120 * 500);
		const resTimeout = await timeoutPromise;
		assert.equal(resTimeout, false);
		assert.equal((showErrorStub.secondCall.args[0] as string).includes("Emulator didn't connect within 60 seconds"), true);
	});
});

class FakeFlutterDaemon extends FakeProcessStdIOService<unknown> implements IFlutterDaemon {
	public capabilities = DaemonCapabilities.empty;
	public supportedPlatforms: f.PlatformType[] | undefined;
	public supportedPlatformsDelaySeconds: number | undefined;

	public async enablePlatformGlobally(_platformType: string): Promise<void> { }

	public async enablePlatform(platformType: string): Promise<void> {
		this.supportedPlatforms = this.supportedPlatforms ?? [];
		this.supportedPlatforms.push(platformType);
	}

	public async checkIfPlatformGloballyDisabled(_platformType: string): Promise<boolean> {
		return false;
	}

	public async connect(d: f.Device, markTypeAsValid: boolean): Promise<void> {
		if (markTypeAsValid && d.platformType)
			await this.enablePlatform(d.platformType);

		await this.notify(this.deviceAddedSubscriptions, d);
	}

	public async disconnect(d: f.Device): Promise<void> {
		await this.notify(this.deviceRemovedSubscriptions, d);
	}

	// Subscription lists.

	private daemonConnectedSubscriptions: Array<(notification: f.DaemonConnected) => void> = [];
	private deviceAddedSubscriptions: Array<(notification: f.Device) => void> = [];
	private deviceRemovedSubscriptions: Array<(notification: f.Device) => void> = [];
	private daemonLogMessageSubscriptions: Array<(notification: f.DaemonLogMessage) => void> = [];
	private daemonLogSubscriptions: Array<(notification: f.DaemonLog) => void> = [];
	private daemonShowMessageSubscriptions: Array<(notification: f.ShowMessage) => void> = [];

	// Request methods.

	public deviceEnable(): Thenable<UnknownResponse> {
		throw new Error("Method not implemented.");
	}
	public emulators: f.FlutterEmulator[] = [androidEmulator, androidBogusEmulatorId, androidBogusEmulatorName, androidEmulatorToOverride];

	public async getEmulators(): Promise<f.FlutterEmulator[]> {
		return this.emulators;
	}
	public launchEmulator(_emulatorId: string): Thenable<void> {
		throw new Error("Method not implemented.");
	}
	public createEmulator(_name?: string): Thenable<{ success: boolean; emulatorName: string; error: string; }> {
		throw new Error("Method not implemented.");
	}
	public async getSupportedPlatforms(projectRoot: string): Promise<f.SupportedPlatformsResponse> {
		if (!projectRoot)
			throw new Error("projectRoot must be specified!");

		if (this.supportedPlatformsDelaySeconds)
			await delay(this.supportedPlatformsDelaySeconds * 1000);

		const platformTypes = Object.fromEntries<{ isSupported: boolean }>(
			[
				...(this.supportedPlatforms ?? ["android", "ios"]).map((p): [string, { isSupported: boolean }] => [p, { isSupported: true }]),
				// Include a dumym platform that is not enabled, to ensure we handled isSupported !== true correctly.
				["dummy-platform", { isSupported: false }]
			]
		);
		return { platformTypes };
	}

	public async serveDevTools(): Promise<f.ServeDevToolsResponse> {
		return { host: "", port: "" };
	}

	public async shutdown(): Promise<void> {
		return;
	}

	// Subscription methods.

	public registerForDaemonConnected(subscriber: (notification: f.DaemonConnected) => void): IAmDisposable {
		return this.subscribe(this.daemonConnectedSubscriptions, subscriber);
	}

	public registerForDeviceAdded(subscriber: (notification: f.Device) => void): IAmDisposable {
		return this.subscribe(this.deviceAddedSubscriptions, subscriber);
	}

	public registerForDeviceRemoved(subscriber: (notification: f.Device) => void): IAmDisposable {
		return this.subscribe(this.deviceRemovedSubscriptions, subscriber);
	}

	public registerForDaemonLogMessage(subscriber: (notification: f.DaemonLogMessage) => void): IAmDisposable {
		return this.subscribe(this.daemonLogMessageSubscriptions, subscriber);
	}

	public registerForDaemonLog(subscriber: (notification: f.DaemonLog) => void): IAmDisposable {
		return this.subscribe(this.daemonLogSubscriptions, subscriber);
	}

	public registerForDaemonShowMessage(subscriber: (notification: f.ShowMessage) => void): IAmDisposable {
		return this.subscribe(this.daemonShowMessageSubscriptions, subscriber);
	}
}
