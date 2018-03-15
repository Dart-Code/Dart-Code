import { config } from "../config";
import { FlutterDeviceManager } from "./device_manager";
import { logError, extensionVersion, reloadExtension } from "../utils";
import { StdIOService, Request, UnknownResponse, UnknownNotification } from "../services/stdio_service";
import * as child_process from "child_process";
import * as f from "./flutter_types";
import * as fs from "fs";
import * as vs from "vscode";
import { flutterEnv } from "../debug/utils";

export class FlutterDaemon extends StdIOService<UnknownNotification> {
	public deviceManager: FlutterDeviceManager;

	constructor(flutterBinPath: string, projectFolder: string) {
		super(config.flutterDaemonLogFile, true);

		this.createProcess(projectFolder, flutterBinPath, ["daemon"], flutterEnv);

		this.deviceManager = new FlutterDeviceManager(this);

		// Enable device polling.
		this.deviceEnable();
	}

	public dispose() {
		this.deviceManager.dispose();
		super.dispose();
	}

	protected sendMessage<T>(json: string) {
		try {
			super.sendMessage(json);
		} catch (e) {
			reloadExtension("The Flutter Daemon has terminated.");
			throw e;
		}
	}

	protected shouldHandleMessage(message: string): boolean {
		// Everything in flutter is wrapped in [] so we can tell what to handle.
		return message.startsWith("[") && message.endsWith("]");
	}

	// TODO: Can we code-gen all this like the analysis server?

	protected handleNotification(evt: UnknownNotification) {
		switch (evt.event) {
			case "device.added":
				this.notify(this.deviceAddedSubscriptions, evt.params as f.Device);
				break;
			case "device.removed":
				this.notify(this.deviceRemovedSubscriptions, evt.params as f.Device);
				break;
		}
	}

	// Subscription lists.

	private deviceAddedSubscriptions: Array<(notification: f.Device) => void> = [];
	private deviceRemovedSubscriptions: Array<(notification: f.Device) => void> = [];

	// Request methods.

	public deviceEnable(): Thenable<UnknownResponse> {
		return this.sendRequest("device.enable");
	}

	// Subscription methods.

	public registerForDeviceAdded(subscriber: (notification: f.Device) => void): vs.Disposable {
		return this.subscribe(this.deviceAddedSubscriptions, subscriber);
	}

	public registerForDeviceRemoved(subscriber: (notification: f.Device) => void): vs.Disposable {
		return this.subscribe(this.deviceRemovedSubscriptions, subscriber);
	}
}
