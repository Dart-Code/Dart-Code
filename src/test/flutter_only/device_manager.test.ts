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
		await daemon.connect(physicalMobile, true);
		assert.deepStrictEqual(dm.currentDevice, physicalMobile);

		// Connect another and ensure it's changed.
		await daemon.connect(emulatedMobile, true);
		assert.deepStrictEqual(dm.currentDevice, emulatedMobile);
	});

	it("auto-selects devices if supported platforms are not known", async () => {
		assert.equal(dm.currentDevice, undefined);

		// connect a device without setting it as valid, but still expect
		// it to be selected because without any explicitly marked valid platforms
		// we assume everything is valid.
		await daemon.connect(physicalMobile, false);
		assert.deepStrictEqual(dm.currentDevice, physicalMobile);
	});

	it("does not auto-select invalid devices", async () => {
		// We treat an empty list of platforms as "everything is supported" so we
		// need to have at least one thing in this list for other devices to be
		// considered invalid.
		daemon.supportedPlatforms = ["invalid"];
		assert.equal(dm.currentDevice, undefined);

		// connect a device and ensure it's not selected.
		await daemon.connect(physicalMobile, false);
		assert.deepStrictEqual(dm.currentDevice, undefined);
	});

	it("un-selects disconnected devices", async () => {
		assert.equal(dm.currentDevice, undefined);
		await daemon.connect(emulatedMobile, true);
		await daemon.connect(physicalMobile, true);

		assert.deepStrictEqual(dm.currentDevice, physicalMobile);
		await daemon.disconnect(physicalMobile);
		assert.deepStrictEqual(dm.currentDevice, emulatedMobile);
		await daemon.disconnect(emulatedMobile);
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
		await daemon.connect(physicalMobile, true);
		assert.deepStrictEqual(dm.currentDevice, physicalMobile);

		// Connecting desktop does not change the selected device.
		await daemon.connect(desktop, true);
		assert.deepStrictEqual(dm.currentDevice, physicalMobile);
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
	public getEmulators(): Thenable<f.Emulator[]> {
		throw new Error("Method not implemented.");
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

const physicalMobile: f.Device = {
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

const emulatedMobile: f.Device = {
	category: "mobile",
	emulator: true,
	emulatorId: undefined,
	ephemeral: true,
	id: "ios-simulator",
	name: "iOS Simulator",
	platform: "ios-something",
	platformType: "ios",
	type: "device",
};
