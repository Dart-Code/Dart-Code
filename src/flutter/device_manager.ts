import * as vs from "vscode";
import { config } from "../config";
import { logError } from "../utils/log";
import { FlutterDaemon } from "./flutter_daemon";
import * as f from "./flutter_types";

const emulatorNameRegex = new RegExp("^[a-z][a-z0-9_]*$");

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
			this.statusBarItem.tooltip = undefined;
			this.statusBarItem.command = undefined;
		} else {
			this.statusBarItem.tooltip = undefined;
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

	public async promptForAndLaunchEmulator(allowAutomaticSelection = false): Promise<boolean> {
		const emulators = (await this.getEmulators())
			.map((e) => ({
				description: e.id,
				emulator: e,
				isCreateEntry: false,
				label: e.name,
			}));

		// Because the above call is async, it's possible a device was connected while we were calling. If so,
		// just use that instead of showing the prompt.
		if (allowAutomaticSelection && this.currentDevice)
			return true;

		// Add an option to create a new emulator if the daemon supports it.
		if (this.daemon.capabilities.canCreateEmulators) {
			emulators.push({
				description: "Creates and launches a new Android emulator",
				emulator: undefined,
				isCreateEntry: true,
				label: "Create New",
			});
		}

		if (emulators.length === 0) {
			return false;
		}

		const cancellationTokenSource = new vs.CancellationTokenSource();
		const waitingForRealDeviceSubscription = this.daemon.registerForDeviceAdded(() => {
			cancellationTokenSource.cancel();
			waitingForRealDeviceSubscription.dispose();
		});
		const selectedEmulator =
			await vs.window.showQuickPick(
				emulators,
				{
					matchOnDescription: true,
					placeHolder: "Connect a device or select an emulator to launch",
				},
				cancellationTokenSource.token);
		waitingForRealDeviceSubscription.dispose();

		if (selectedEmulator && selectedEmulator.isCreateEntry) {
			// TODO: Allow user to create names when we let them customise the emulator type.
			// const name = await vs.window.showInputBox({
			// 	prompt: "Enter a name for your new Android Emulator",
			// 	validateInput: this.validateEmulatorName,
			// });
			// if (!name) bail() // Pressing ENTER doesn't work, but escape does, so if
			// no name, user probably wanted to cancel
			const name: string = undefined;
			const create = this.daemon.createEmulator(name);
			vs.window.withProgress({
				location: vs.ProgressLocation.Notification,
				title: `${`Creating emulator ${name ? name : ""}`.trim()}...`,
			}, (progress) => create);
			const res = await create;
			if (res.success) {
				return this.launchEmulator({
					id: res.emulatorName,
					name: res.emulatorName,
				});
			} else {
				vs.window.showErrorMessage(res.error);
			}
		} else if (selectedEmulator) {
			return this.launchEmulator(selectedEmulator.emulator);
		} else {
			return !!this.currentDevice;
		}
	}

	private validateEmulatorName(input: string) {
		if (!emulatorNameRegex.test(input))
			return "Emulator names should contain only letters, numbers, dots, underscores and dashes";
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
					await new Promise((resolve) => setTimeout(resolve, 500));
					if (this.currentDevice)
						return;
				}
				throw new Error("Emulator didn't connected within 60 seconds");
			});
		} catch (e) {
			vs.window.showErrorMessage(`Failed to launch emulator: ${e}`);
			return false;
		}
		// Wait an additional second to try and void some possible races.
		await new Promise((resolve) => setTimeout(resolve, 1000));
		return true;
	}
}
