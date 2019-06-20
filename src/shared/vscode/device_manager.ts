import * as vs from "vscode";
import * as f from "../flutter/daemon_interfaces";
import { IFlutterDaemon, Logger } from "../interfaces";
import { isRunningLocally } from "./utils";

export class FlutterDeviceManager implements vs.Disposable {
	private subscriptions: vs.Disposable[] = [];
	private statusBarItem: vs.StatusBarItem;
	private devices: f.Device[] = [];
	public currentDevice?: f.Device;

	constructor(private readonly logger: Logger, private daemon: IFlutterDaemon, private readonly autoSelectNewlyConnectedDevices: boolean) {
		this.statusBarItem = vs.window.createStatusBarItem(vs.StatusBarAlignment.Right, 1);
		this.statusBarItem.tooltip = "Flutter";
		this.statusBarItem.command = "flutter.selectDevice";
		this.updateStatusBar();

		this.subscriptions.push(this.statusBarItem);

		daemon.registerForDeviceAdded(this.deviceAdded.bind(this));
		daemon.registerForDeviceRemoved(this.deviceRemoved.bind(this));
	}

	public dispose() {
		this.subscriptions.forEach((s) => s.dispose());
	}

	public isSupported(types: f.PlatformType[], device: { platformType: f.PlatformType }) {
		// If we don't get any types to filter, assume everything is valid.
		return device && (!types || !types.length || types.indexOf(device.platformType) !== -1);
	}

	public deviceAdded(dev: f.Device) {
		dev = { ...dev, type: "device" };
		this.devices.push(dev);
		// undefined is treated as true for backwards compatibility.
		const canAutoSelectDevice = dev.ephemeral !== false;
		if (!this.currentDevice || (this.autoSelectNewlyConnectedDevices && canAutoSelectDevice)) {
			this.currentDevice = dev;
			this.updateStatusBar();
		}
	}

	public deviceRemoved(dev: f.Device) {
		this.devices = this.devices.filter((d) => d.id !== dev.id);
		if (this.currentDevice && this.currentDevice.id === dev.id) {
			this.currentDevice = this.devices.length === 0 ? undefined : this.devices[this.devices.length - 1];
			this.updateStatusBar();
		}
	}

	public async showDevicePicker(supportedTypes?: f.PlatformType[]): Promise<f.Device> {
		const devices: PickableDevice[] = this.devices
			.sort(this.deviceSortComparer.bind(this))
			.filter((d) => this.isSupported(supportedTypes, d))
			.map((d) => ({
				description: d.category || d.platform,
				device: d,
				label: d.name,
			}));

		const quickPick = vs.window.createQuickPick<PickableDevice>();
		quickPick.items = devices;
		quickPick.placeholder = "Select a device to use";
		quickPick.busy = true;

		// Also kick of async work to add emulators to the list (if they're valid).
		this.getEmulatorItems(true, supportedTypes).then((emulators) => {
			quickPick.busy = false;
			quickPick.items = [...devices, ...emulators];
		});

		const selection = await new Promise<PickableDevice>((resolve) => {
			quickPick.onDidAccept(() => resolve(quickPick.selectedItems && quickPick.selectedItems[0]));
			quickPick.onDidHide(() => resolve(undefined));
			quickPick.show();
		});
		quickPick.dispose();
		if (selection && selection.device) {
			const emulatorTypeLabel = this.emulatorLabel(selection.device.platformType);
			switch (selection.device.type) {
				case "emulator-creator":
					// Clear the current device so we can wait for the new one
					// to connect.
					this.currentDevice = undefined;
					this.statusBarItem.text = `Creating ${emulatorTypeLabel}...`;
					await this.createEmulator();
					break;
				case "emulator":
					// Clear the current device so we can wait for the new one
					// to connect.
					this.currentDevice = undefined;
					this.statusBarItem.text = `Launching ${emulatorTypeLabel}...`;
					await this.launchEmulator(selection.device);
					break;
				case "device":
					this.currentDevice = selection.device;
					this.updateStatusBar();
					break;
			}
		}

		return this.currentDevice;
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
			this.statusBarItem.text = `${this.currentDevice.name} (${this.currentDevice.platform} ${this.currentDevice.emulator ? this.emulatorLabel(this.currentDevice.platformType) : ""})`.trim();
		else
			this.statusBarItem.text = "No Devices";

		if (this.devices.length > 1) {
			this.statusBarItem.tooltip = `${this.devices.length} Devices Connected`;
		} else if (this.devices.length === 1) {
			this.statusBarItem.tooltip = `1 Device Connected`;
		} else {
			this.statusBarItem.tooltip = undefined;
		}
	}

	private async getEmulators(): Promise<f.Emulator[]> {
		try {
			const emus = await this.daemon.getEmulators();
			return emus.map((e) => ({
				category: e.category,
				id: e.id,
				name: e.name || e.id,
				platformType: e.platformType,
				type: "emulator",
			}));
		} catch (e) {
			this.logger.error({ message: e });
			return [];
		}
	}

	private isMobile(device: f.Device) {
		// Treat missing platformType as mobile, since we don't know better.
		return !device.platformType || device.platformType === "ios" || device.platformType === "android";
	}

	public async promptForAndLaunchEmulator(allowAutomaticSelection = false): Promise<boolean> {
		const emulators = await this.getEmulatorItems(false);

		// Because the above call is async, it's possible a device was connected while we were calling. If so,
		// just use that instead of showing the prompt.
		if (allowAutomaticSelection && this.currentDevice)
			return true;

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

		if (selectedEmulator && selectedEmulator.device && selectedEmulator.device.type === "emulator-creator") {
			return this.createEmulator();
		} else if (selectedEmulator && selectedEmulator.device && selectedEmulator.device.type === "emulator") {
			return this.launchEmulator(selectedEmulator.device);
		} else {
			return !!(this.currentDevice);
		}
	}

	private async createEmulator(): Promise<boolean> {
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
		}, () => create);
		const res = await create;
		if (res.success) {
			return this.launchEmulator({
				id: res.emulatorName,
				name: res.emulatorName,
			});
		} else {
			vs.window.showErrorMessage(res.error);
			return false;
		}
	}

	private emulatorLabel(platformType: f.PlatformType | undefined | null) {
		return platformType && (platformType === "ios" || platformType === "macos")
			? "simulator"
			: "emulator";
	}

	private async getEmulatorItems(showAsEmulators: boolean, supportedTypes?: f.PlatformType[]): Promise<PickableDevice[]> {
		const emulators: PickableDevice[] = (await this.getEmulators())
			.filter((e) => this.isSupported(supportedTypes, e))
			.map((e) => ({
				alwaysShow: false,
				description: showAsEmulators ? `${e.category || "mobile"} ${this.emulatorLabel(e.platformType)}` : e.platformType,
				device: {
					...e,
					type: "emulator",
				},
				label: showAsEmulators ? `Start ${e.name}` : e.name,
			}));

		// Add an option to create a new emulator if the daemon supports it.
		if (this.daemon.capabilities.canCreateEmulators && isRunningLocally && this.isSupported(supportedTypes, { platformType: "android" })) {
			emulators.push({
				alwaysShow: true,
				device: { type: "emulator-creator", platformType: "android" },
				label: "Create Android emulator",
			});
		}
		return emulators;
	}

	private async launchEmulator(emulator: { id: string, name: string }): Promise<boolean> {
		try {
			await vs.window.withProgress({
				location: vs.ProgressLocation.Notification,
			}, async (progress) => {
				progress.report({ message: `Launching ${emulator.name}...` });
				await this.daemon.launchEmulator(emulator.id);
				progress.report({ message: `Waiting for ${emulator.name} to connect...` });
				// Wait up to 60 seconds for emulator to launch.
				for (let i = 0; i < 120; i++) {
					await new Promise((resolve) => setTimeout(resolve, 500));
					if (this.currentDevice)
						return;
				}
				throw new Error("Emulator didn't connect within 60 seconds");
			});
		} catch (e) {
			vs.window.showErrorMessage(`Failed to launch ${emulator.name}: ${e}`);
			return false;
		}
		// Wait an additional second to try and void some possible races.
		await new Promise((resolve) => setTimeout(resolve, 1000));
		return true;
	}
}

type PickableDevice = vs.QuickPickItem & { device: f.Device | f.Emulator | f.EmulatorCreator };
