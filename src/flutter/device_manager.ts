"use strict";

import * as vs from "vscode";
import { FlutterDaemon } from "./flutter_daemon";
import * as f from "./flutter_types";

export class FlutterDeviceManager implements vs.Disposable {
	private subscriptions: vs.Disposable[] = [];
	private statusBarItem: vs.StatusBarItem;
	private devices: f.Device[] = [];
	currentDevice: f.Device = null;

	constructor(daemon: FlutterDaemon) {
		this.statusBarItem = vs.window.createStatusBarItem(vs.StatusBarAlignment.Right, 0);
		this.statusBarItem.tooltip = "Flutter";
		this.statusBarItem.show();
		this.updateStatusBar();

		this.subscriptions.push(this.statusBarItem);
		this.subscriptions.push(vs.commands.registerCommand("flutter.changeDevice", this.changeDevice.bind(this)));

		daemon.registerForDeviceAdded(this.deviceAdded.bind(this));
		daemon.registerForDeviceRemoved(this.deviceRemoved.bind(this));
	}

	dispose() {
		this.statusBarItem.dispose();
	}

	deviceAdded(dev: f.Device) {
		this.devices.push(dev);
		this.currentDevice = dev;
		this.updateStatusBar();
	}

	deviceRemoved(dev: f.Device) {
		this.devices = this.devices.filter(d => d.id != dev.id);
		if (this.currentDevice.id == dev.id)
			this.currentDevice = this.devices.length == 0 ? null : this.devices[this.devices.length - 1];
		this.updateStatusBar();
	}

	changeDevice() {
		const devices = this.devices
			.sort(this.deviceSortComparer.bind(this))
			.map(d => ({
				device: d,
				label: d.name,
				description: d.platform,
				detail: d == this.currentDevice ? "Current Device" : (d.emulator ? "Emulator" : "Physical Device")
			}));
		vs.window.showQuickPick(devices, { placeHolder: "Select a device to use" })
			.then(d => { if (d) { this.currentDevice = d.device; this.updateStatusBar(); } })
	}

	deviceSortComparer(d1: f.Device, d2: f.Device): number {
		// Always consider current device to be first.
		if (d1 == this.currentDevice) return -1;
		if (d2 == this.currentDevice) return 1;
		// Otherwise, sort by name.
		return d1.name.localeCompare(d2.name);
	}

	updateStatusBar(): void {
		if (this.currentDevice)
			this.statusBarItem.text = `${this.currentDevice.name} (${this.currentDevice.platform}${this.currentDevice.emulator ? " Emulator" : ""})`;
		else
			this.statusBarItem.text = "No Devices";

		if (this.devices.length > 1) {
			this.statusBarItem.tooltip = `${this.devices.length} Devices Connected`;
			this.statusBarItem.command = "flutter.changeDevice";
		}
		else {
			this.statusBarItem.tooltip = null;
			this.statusBarItem.command = null;
		}
	}
}