import * as vs from "vscode";
import { config } from "../config";
import { logError } from "../utils";
import { FlutterDaemon } from "./flutter_daemon";
import * as f from "./flutter_types";

export class FlutterDeviceManager implements vs.Disposable {
	private subscriptions: vs.Disposable[] = [];
	private statusBarItem: vs.StatusBarItem;
	private devices: f.Device[] = [];
	public currentDevice: f.Device = null;

	constructor(private daemon: FlutterDaemon) {
		this.statusBarItem = vs.window.createStatusBarItem(vs.StatusBarAlignment.Right, 1);
		this.statusBarItem.tooltip = "Flutter";
		this.statusBarItem.show();
		this.updateStatusBar();

		this.subscriptions.push(this.statusBarItem);
		this.subscriptions.push(vs.commands.registerCommand("flutter.selectDevice", this.showDevicePicker, this));
		this.subscriptions.push(vs.commands.registerCommand("flutter.launchEmulator", this.promptForAndLaunchEmulator, this));

		daemon.registerForDeviceAdded(this.deviceAdded.bind(this));
		daemon.registerForDeviceRemoved(this.deviceRemoved.bind(this));
	}

	public dispose() {
		this.subscriptions.forEach((s) => s.dispose());
	}

	public deviceAdded(dev: f.Device) {
		this.devices.push(dev);
		if (this.currentDevice == null || config.flutterSelectDeviceWhenConnected) {
			this.currentDevice = dev;
		}
		this.updateStatusBar();
	}

	public deviceRemoved(dev: f.Device) {
		this.devices = this.devices.filter((d) => d.id !== dev.id);
		if (this.currentDevice.id === dev.id)
			this.currentDevice = this.devices.length === 0 ? null : this.devices[this.devices.length - 1];
		this.updateStatusBar();
	}

	public async showDevicePicker(): Promise<void> {
		const devices = this.devices
			.sort(this.deviceSortComparer.bind(this))
			.map((d) => ({
				description: d.platform,
				detail: d === this.currentDevice ? "Current Device" : (d.emulator ? "Emulator" : "Physical Device"),
				device: d,
				label: d.name,
			}));
		const d = await vs.window.showQuickPick(devices, { placeHolder: "Select a device to use" });
		if (d) {
			this.currentDevice = d.device;
			this.updateStatusBar();
		}
	}

	public deviceSortComparer(d1: f.Device, d2: f.Device): number {
		// Always consider current device to be first.
		if (d1 === this.currentDevice) return -1;
		if (d2 === this.currentDevice) return 1;
		// Otherwise, sort by name.
		return d1.name.localeCompare(d2.name);
	}

	public updateStatusBar(): void {
		if (this.currentDevice)
			this.statusBarItem.text = `${this.currentDevice.name} (${this.currentDevice.platform}${this.currentDevice.emulator ? " Emulator" : ""})`;
		else
			this.statusBarItem.text = "No Devices";

		// Don't show the progress bar until we're ready (eg. we may have kicked off a Dart download).
		if (!this.daemon.isReady) {
			this.statusBarItem.hide();
		} else {
			this.statusBarItem.show();
		}

		if (this.devices.length > 1) {
			this.statusBarItem.tooltip = `${this.devices.length} Devices Connected`;
			this.statusBarItem.command = "flutter.selectDevice";
		} else if (this.devices.length === 1) {
			this.statusBarItem.tooltip = null;
			this.statusBarItem.command = null;
		} else {
			this.statusBarItem.tooltip = null;
			this.statusBarItem.command = "flutter.launchEmulator";
		}
	}

	private async getEmulators(): Promise<Array<{ id: string, name: string }>> {
		try {
			const emus = await this.daemon.getEmulators();
			return emus.map((e) => ({
				id: e.id,
				name: e.name || e.id,
			}));
		} catch (e) {
			logError({ message: e });
			return [];
		}
	}

	public async promptForAndLaunchEmulator(): Promise<boolean> {
		const emulators = (await this.getEmulators())
			.map((e) => ({
				description: e.id,
				emulator: e,
				label: e.name,
			}));
		if (emulators.length === 0) {
			return false;
		}

		const cancellationTokenSource = new vs.CancellationTokenSource();
		const waitingForRealDeviceSubscription = this.daemon.registerForDeviceAdded(() => {
			cancellationTokenSource.cancel();
			waitingForRealDeviceSubscription.dispose();
		});
		const selectedEmulator =
			await vs.window.showQuickPick(emulators, { placeHolder: "Connect a device or select an emulator to launch" }, cancellationTokenSource.token);
		waitingForRealDeviceSubscription.dispose();

		if (selectedEmulator) {
			return this.launchEmulator(selectedEmulator.emulator);
		} else {
			return !!this.currentDevice;
		}
	}

	private async launchEmulator(emulator: { id: string, name: string }): Promise<boolean> {
		try {
			await vs.window.withProgress({
				cancellable: false,
				location: vs.ProgressLocation.Notification,
				title: `Launching ${emulator.name}...`,
			}, async (progress) => {
				await this.daemon.launchEmulator(emulator.id);
				progress.report({ message: `Waiting for ${emulator.name} to connect...` });
				// Wait up to 60 seconds for emulator to launch.
				for (let i = 0; i < 120; i++) {
					await new Promise((resolve, reject) => setTimeout(resolve, 500));
					if (this.currentDevice)
						return;
				}
				throw new Error("Emulator didn't connected within 60 seconds");
			});
		} catch (e) {
			vs.window.showErrorMessage(`Failed to launch emulator: ${e}`);
			return false;
		}
		return true;
	}
}
