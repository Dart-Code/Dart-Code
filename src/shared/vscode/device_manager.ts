import * as vs from "vscode";
import { flatMap } from "../../shared/utils";
import { findProjectFolders } from "../../shared/utils/fs";
import { fsPath, getDartWorkspaceFolders } from "../../shared/vscode/utils";
import * as f from "../flutter/daemon_interfaces";
import { IFlutterDaemon, Logger } from "../interfaces";
import { unique } from "../utils/array";
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
		this.statusBarItem.show();
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

	public async deviceAdded(dev: f.Device): Promise<void> {
		dev = { ...dev, type: "device" };
		this.devices.push(dev);
		// undefined is treated as true for backwards compatibility.
		const canAutoSelectDevice = dev.ephemeral !== false;
		const maySelectThisDevice = () => !this.currentDevice || (this.autoSelectNewlyConnectedDevices && canAutoSelectDevice);
		if (maySelectThisDevice()) {
			// Finally, check if it's valid for the workspace. We don't want to
			// auto-select to a mobile if you have a web-only project open.
			const supportedPlatforms = await this.getSupportedPlatformsForWorkspace();
			// We need to re-check maySelectThisDevice() as the answer may have changed if
			// another device was selected while we were awaiting (which would prevent us
			// selecting a non-ephemeral device here).
			if (maySelectThisDevice() && this.isSupported(supportedPlatforms, dev)) {
				this.currentDevice = dev;
				this.updateStatusBar();
			}
		}
	}

	public async deviceRemoved(dev: f.Device) {
		this.devices = this.devices.filter((d) => d.id !== dev.id);
		if (this.currentDevice && this.currentDevice.id === dev.id) {
			this.currentDevice = undefined;

			// Try to select the next-best device
			if (this.devices.length) {
				const supportedPlatforms = await this.getSupportedPlatformsForWorkspace();
				const supportedDevices = this.devices.filter((d) => this.isSupported(supportedPlatforms, d));
				if (supportedDevices && supportedDevices.length)
					this.currentDevice = supportedDevices[0];
			}

			this.updateStatusBar();
		}
	}

	public async showDevicePicker(supportedTypes?: f.PlatformType[]): Promise<f.Device> {
		// If we weren't passed any supported types, we should try to get them for
		// the whole workspace.
		if (!supportedTypes && this.daemon.capabilities.providesPlatformTypes) {
			supportedTypes = await this.getSupportedPlatformsForWorkspace();
		}
		const quickPick = vs.window.createQuickPick<PickableDevice>();
		quickPick.placeholder = "Select a device to use";
		quickPick.busy = true;

		let quickPickIsValid = true;
		let emulatorDevices: PickableDevice[];
		const updatePickableDeviceList = () => {
			if (!quickPickIsValid)
				return;

			const pickableItems: PickableDevice[] = this.devices
				.sort(this.deviceSortComparer.bind(this))
				.filter((d) => this.isSupported(supportedTypes, d))
				.map((d) => ({
					description: d.category || d.platform,
					device: d,
					label: d.name,
				}));

			// If we've got emulators, add them to the list.
			if (emulatorDevices) {
				// Fliter out any emulators we know are running.
				const emulatorIdsAlreadyRunning = this.devices.map((d) => d.emulatorId).filter((id) => id);

				emulatorDevices
					.filter((e) => emulatorIdsAlreadyRunning.indexOf(e.device.id) === -1)
					.forEach((e) => pickableItems.push(e));
			}

			quickPick.items = pickableItems;
		};

		// Kick off a request to get emulators only once.
		this.getEmulatorItems(true, supportedTypes)
			.then((emulators) => emulatorDevices = emulators)
			.then(() => quickPick.busy = false)
			.then(() => updatePickableDeviceList());

		// If new devices are attached while the list is open, add them to the end.
		const deviceAddedSubscription = this.daemon.registerForDeviceAdded((d) => updatePickableDeviceList());
		const deviceRemovedSubscription = this.daemon.registerForDeviceRemoved((d) => updatePickableDeviceList());

		// Build the initial list.
		updatePickableDeviceList();

		const selection = await new Promise<PickableDevice>((resolve) => {
			quickPick.onDidAccept(() => resolve(quickPick.selectedItems && quickPick.selectedItems[0]));
			quickPick.onDidHide(() => resolve(undefined));
			quickPick.show();
		});
		quickPickIsValid = false;
		quickPick.dispose();
		deviceAddedSubscription.dispose();
		deviceRemovedSubscription.dispose();
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

			return this.currentDevice;
		}

		return undefined;
	}

	private shortCacheForSupportedPlatforms: Promise<f.PlatformType[] | undefined>;
	private async getSupportedPlatformsForWorkspace(): Promise<f.PlatformType[] | undefined> {
		// To avoid triggering this lots of times at startup when lots of devices "connect" at
		// the same time, we cache the results for 10 seconds. Every time we set the cache, we
		// set a timer to expire it in 10 seconds.
		if (this.shortCacheForSupportedPlatforms) {
			this.logger.info(`Returning cached promise for getSupportedPlatforms()`);
			return this.shortCacheForSupportedPlatforms;
		}

		this.shortCacheForSupportedPlatforms = new Promise(async (resolve) => {
			const topLevelFolders = getDartWorkspaceFolders().map((wf) => fsPath(wf.uri));
			const projectFolders = findProjectFolders(topLevelFolders, { requirePubspec: true });
			this.logger.info(`Checking ${projectFolders.length} projects for supported platforms`);

			const getPlatformPromises = projectFolders.map((folder) => this.daemon.getSupportedPlatforms(folder));
			const resps = await Promise.all(getPlatformPromises).catch((e): f.SupportedPlatformsResponse[] => {
				this.logger.error(e);
				return [];
			});

			const supportedTypes = unique(flatMap(resps, (r) => r.platforms));
			this.logger.info(`Supported platforms for the workspace are ${supportedTypes.join(", ")}`);

			resolve(supportedTypes);
			setTimeout(() => this.shortCacheForSupportedPlatforms = undefined, 10000);
		});

		return this.shortCacheForSupportedPlatforms;
	}

	public deviceSortComparer(d1: f.Device, d2: f.Device): number {
		// Always consider current device to be first.
		if (d1 === this.currentDevice) return -1;
		if (d2 === this.currentDevice) return 1;
		// Otherwise, sort by name.
		return d1.name.localeCompare(d2.name);
	}

	public updateStatusBar(): void {
		if (this.currentDevice) {
			const emulatorLabel = this.currentDevice.emulator ? this.emulatorLabel(this.currentDevice.platformType) : "";
			const platformLabel = `${this.currentDevice.platform} ${emulatorLabel}`.trim();
			this.statusBarItem.text = `${this.currentDevice.name} (${platformLabel})`.trim();
		} else {
			this.statusBarItem.text = "No Device";
		}

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
		if (!isRunningLocally)
			return [];

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
		if (this.daemon.capabilities.canCreateEmulators && this.isSupported(supportedTypes, { platformType: "android" })) {
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
