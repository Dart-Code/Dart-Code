import * as vs from "vscode";
import { config } from "../config";
import { StdIOService, UnknownNotification, UnknownResponse } from "../services/stdio_service";
import { reloadExtension } from "../utils";
import { FlutterDeviceManager } from "./device_manager";
import * as f from "./flutter_types";

export class FlutterDaemon extends StdIOService<UnknownNotification> {
	public deviceManager: FlutterDeviceManager;

	constructor(flutterBinPath: string, projectFolder: string) {
		super(() => config.flutterDaemonLogFile, true);

		this.createProcess(projectFolder, flutterBinPath, ["daemon"]);

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

	private static readonly outOfDateWarning = new RegExp("WARNING: .* Flutter is (\\d+) days old");
	protected processUnhandledMessage(message: string): void {
		const matches = FlutterDaemon.outOfDateWarning.exec(message);
		if (!matches || matches.length !== 2)
			return;

		vs.window.showWarningMessage(`Your installation of Flutter is ${matches[1]} days old. To update to the latest version, run 'flutter upgrade'.`);
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

	public getEmulators(): Thenable<Array<{ id: string, name: string }>> {
		return this.sendRequest("emulator.getEmulators");
	}

	public launchEmulator(emulatorId: string): Thenable<void> {
		return this.sendRequest("emulator.launch", { emulatorId });
	}

	// Subscription methods.

	public registerForDeviceAdded(subscriber: (notification: f.Device) => void): vs.Disposable {
		return this.subscribe(this.deviceAddedSubscriptions, subscriber);
	}

	public registerForDeviceRemoved(subscriber: (notification: f.Device) => void): vs.Disposable {
		return this.subscribe(this.deviceRemovedSubscriptions, subscriber);
	}
}
