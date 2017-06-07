"use strict";

import * as vs from "vscode";
import { FlutterDaemon } from "./flutter_daemon";
import * as f from "./flutter_types";

export class FlutterDeviceManager extends vs.Disposable {
	private statusBarItem: vs.StatusBarItem;
	private devices: f.Device[] = [];

	constructor(daemon: FlutterDaemon) {
		super(() => this.statusBarItem.dispose());
		this.statusBarItem = vs.window.createStatusBarItem(vs.StatusBarAlignment.Right, 0);
		this.statusBarItem.tooltip = "Flutter";
		this.statusBarItem.show();
		this.updateStatusBar();

		daemon.registerForDeviceAdded(n => { this.devices.push(n); this.updateStatusBar(); });
		daemon.registerForDeviceRemoved(n => { this.devices = this.devices.filter(d => d.id != n.id); this.updateStatusBar(); });
	}

	updateStatusBar(): void {
		if (this.devices.length == 0)
			this.statusBarItem.text = "No Devices";
		else if (this.devices.length == 1) {
			let dev = this.devices[0];
			this.statusBarItem.text = `${dev.name} (${dev.platform}${dev.emulator ? " Emulator" : ""})`;
		}
		else
			this.statusBarItem.text = `${this.devices.length} Devices`;
	}
}