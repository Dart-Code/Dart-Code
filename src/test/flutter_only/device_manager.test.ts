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

	it("auto-selects devices", () => {
		assert.equal(dm.currentDevice, undefined);

		// connect a device and ensure it's selected.
		daemon.connect(physicalMobile);
		assert.deepStrictEqual(dm.currentDevice, physicalMobile);

		// Connect another and ensure it's changed.
		daemon.connect(emulatedMobile);
		assert.deepStrictEqual(dm.currentDevice, emulatedMobile);
	});

	it("un-selects disconnected devices", () => {
		assert.equal(dm.currentDevice, undefined);
		daemon.connect(emulatedMobile);
		daemon.connect(physicalMobile);

		assert.deepStrictEqual(dm.currentDevice, physicalMobile);
		daemon.disconnect(physicalMobile);
		assert.deepStrictEqual(dm.currentDevice, emulatedMobile);
		daemon.disconnect(emulatedMobile);
		assert.deepStrictEqual(dm.currentDevice, undefined);
	});

	it("will auto-select a non-ephemeral device if there is no other device", () => {
		assert.deepStrictEqual(dm.currentDevice, undefined);
		daemon.connect(desktop);
		assert.deepStrictEqual(dm.currentDevice, desktop);
	});

	it("will not auto-select a non-ephemeral device if there another device", () => {
		daemon.connect(physicalMobile);
		assert.deepStrictEqual(dm.currentDevice, physicalMobile);
		daemon.connect(desktop);
		assert.deepStrictEqual(dm.currentDevice, physicalMobile);
	});
});

class FakeFlutterDaemon extends FakeStdIOService implements IFlutterDaemon {
	public capabilities: DaemonCapabilities;

	public connect(d: f.Device) {
		this.notify(this.deviceAddedSubscriptions, d);
	}

	public disconnect(d: f.Device) {
		this.notify(this.deviceRemovedSubscriptions, d);
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
	public getSupportedPlatforms(projectRoot: string): Thenable<f.SupportedPlatformsResponse> {
		throw new Error("Method not implemented.");
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
