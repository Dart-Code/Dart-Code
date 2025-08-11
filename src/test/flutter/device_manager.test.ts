import { strict as assert } from "assert";
import { commands } from "vscode";
import { DaemonCapabilities } from "../../shared/capabilities/flutter";
import * as f from "../../shared/flutter/daemon_interfaces";
import { CustomEmulatorDefinition, IAmDisposable, IFlutterDaemon } from "../../shared/interfaces";
import { UnknownResponse } from "../../shared/services/interfaces";
import { FlutterDeviceManager, PickableDevice } from "../../shared/vscode/device_manager";
import { activateWithoutAnalysis, delay, logger, privateApi, sb } from "../helpers";
import { FakeProcessStdIOService } from "../services/fake_stdio_service";

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

	afterEach(() => {
		dm.dispose();
		daemon.dispose();
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
		const devices = dm.getPickableDevices(["android"]);
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
		daemon.supportedPlatforms = ["a", "b"];
		daemon.supportedPlatformsDelaySeconds = 10;
		const platforms = await dm.tryGetSupportedPlatformTypes("fake");
		assert.equal(platforms, undefined);
	});
});

class FakeFlutterDaemon extends FakeProcessStdIOService<unknown> implements IFlutterDaemon {
	public capabilities = DaemonCapabilities.empty;
	public supportedPlatforms: f.PlatformType[] | undefined;
	public supportedPlatformsDelaySeconds: number | undefined;
	public daemonStarted = Promise.resolve();

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
	public async getEmulators(): Promise<f.FlutterEmulator[]> {
		return [androidEmulator, androidBogusEmulatorId, androidBogusEmulatorName, androidEmulatorToOverride];
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

		const platformTypes = Object.fromEntries(
			[
				...(this.supportedPlatforms ?? ["android", "ios"]).map((p) => [p, { isSupported: true }]),
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

const desktop: f.Device & { platformType: string } = {
	category: "desktop",
	emulator: false,
	emulatorId: undefined,
	ephemeral: false,
	id: "my-mac",
	name: "My MacBook",
	platform: "darwin-x64",
	platformType: "macos",
	type: "device",
};

const webChrome: f.Device & { platformType: string } = {
	category: "web",
	emulator: false,
	emulatorId: undefined,
	ephemeral: false,
	id: "chrome",
	name: "Chrome",
	platform: "web-javascript",
	platformType: "web",
	type: "device",
};

const physicalAndroidMobile: f.Device = {
	category: "mobile",
	emulator: false,
	emulatorId: undefined,
	ephemeral: true,
	id: "my-eyephone",
	name: "My eyePhone",
	platform: "android-x64",
	platformType: "android",
	type: "device",
};

const emulatedAndroidMobile: f.Device = {
	category: "mobile",
	emulator: true,
	emulatorId: "my_emulator_id",
	ephemeral: true,
	id: "android-pixel-7",
	name: "Pixel 7",
	platform: "android-x87",
	platformType: "android",
	type: "device",
};

const androidEmulator: f.FlutterEmulator = {
	category: "mobile",
	id: "my_emulator_id",
	name: "My Cool Emulator!",
	platformType: "android",
};

const androidEmulatorToOverride: f.FlutterEmulator = {
	category: "mobile",
	id: "my_emulator_id_to_override",
	name: "WILL BE OVERRIDEN EMULATOR",
	platformType: "android",
};

const androidBogusEmulatorName: f.FlutterEmulator = {
	category: "mobile",
	id: "my_bogus_emulator",
	name: "INFO     | my error message https://github.com/Dart-Code/Dart-Code/issues/5052",
	platformType: "android",
};

const androidBogusEmulatorId: f.FlutterEmulator = {
	category: "mobile",
	id: "INFO     | my_bogus_emulator",
	name: "My bogus emulator",
	platformType: "android",
};

const emulatediOSMobile: f.Device = {
	category: "mobile",
	emulator: true,
	emulatorId: "my_emulator_id",
	ephemeral: true,
	id: "ios-simulator",
	name: "iOS Simulator",
	platform: "ios-something",
	platformType: "ios",
	type: "device",
};

const customEmulator1: CustomEmulatorDefinition = {
	args: ["args"],
	executable: "echo",
	id: "my-custom-emulator",
	name: "My custom emulator",
};

const customEmulator2: CustomEmulatorDefinition = {
	args: ["args"],
	executable: "echo",
	id: "my_emulator_id_to_override",
	name: "My emulator override",
};

const customEmulators = [customEmulator1, customEmulator2];
