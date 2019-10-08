import * as assert from "assert";
import { DaemonCapabilities } from "../../shared/capabilities/flutter";
import * as f from "../../shared/flutter/daemon_interfaces";
import { IAmDisposable, IFlutterDaemon } from "../../shared/interfaces";
import { UnknownResponse } from "../../shared/services/interfaces";
import { FlutterDeviceManager } from "../../shared/vscode/device_manager";
import { logger } from "../helpers";
import { FakeStdIOService } from "../services/fake_stdio_service";

describe("device_manager", () => {
	let dm: FlutterDeviceManager;
	let daemon: FakeFlutterDaemon;

	beforeEach(() => {
		daemon = new FakeFlutterDaemon();
		dm = new FlutterDeviceManager(logger, daemon, true);
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

	it("generates the correct label for Android emulator devices", async () => {
		assert.equal(dm.currentDevice, undefined);

		// connect a device that has an emaultor ID and ensure we correctly build
		// it's label (which happens by fetching the emulator list up-front and
		// then looking it up).
		await daemon.connect(emulatedAndroidMobile, true);
		assert.deepStrictEqual(dm.currentDevice, emulatedAndroidMobile);
		assert.deepStrictEqual(dm.labelForDevice(dm.currentDevice), androidEmulator.name);
	});

	it("uses the standard device name for iOS simulator devices", async () => {
		assert.equal(dm.currentDevice, undefined);

		// For iOS, we don't use the emulator names since it's just "iOS Simulator"
		// instead of "iPhone X" etc.
		await daemon.connect(emulatediOSMobile, true);
		assert.deepStrictEqual(dm.currentDevice, emulatediOSMobile);
		assert.deepStrictEqual(dm.labelForDevice(dm.currentDevice!), emulatediOSMobile.name);
	});

	it("auto-selects devices if supported platforms are not known", async () => {
		assert.equal(dm.currentDevice, undefined);

		// connect a device without setting it as valid, but still expect
		// it to be selected because without any explicitly marked valid platforms
		// we assume everything is valid.
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
});

class FakeFlutterDaemon extends FakeStdIOService implements IFlutterDaemon {
	public capabilities = DaemonCapabilities.empty;
	public supportedPlatforms: f.PlatformType[] = [];

	public async connect(d: f.Device, markTypeAsValid: boolean): Promise<void> {
		if (markTypeAsValid && d.platformType)
			this.supportedPlatforms.push(d.platformType);

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
	public async getEmulators(): Promise<f.Emulator[]> {
		return [androidEmulator];
	}
	public launchEmulator(emulatorId: string): Thenable<void> {
		throw new Error("Method not implemented.");
	}
	public createEmulator(name?: string): Thenable<{ success: boolean; emulatorName: string; error: string; }> {
		throw new Error("Method not implemented.");
	}
	public async getSupportedPlatforms(projectRoot: string): Promise<f.SupportedPlatformsResponse> {
		if (!projectRoot)
			throw new Error("projectRoot must be specified!");

		return { platforms: this.supportedPlatforms };
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

const desktop: f.Device = {
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

const androidEmulator: f.Emulator = {
	category: "mobile",
	id: "my_emulator_id",
	name: "My Cool Emulator!",
	platformType: "android",
	type: "emulator",
};

const physicaliOSMobile: f.Device = {
	category: "mobile",
	emulator: false,
	emulatorId: undefined,
	ephemeral: true,
	id: "my-iphone",
	name: "My iPhone",
	platform: "ios-x64",
	platformType: "ios",
	type: "device",
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

const iOSEmulator: f.Emulator = {
	category: "mobile",
	id: "my_emulator_id",
	name: "My Cool iOS Emulator!",
	platformType: "ios",
	type: "emulator",
};
