import * as vs from "vscode";
import { ProgressLocation } from "vscode";
import { config } from "../config";
import { PromiseCompleter } from "../debug/utils";
import { StdIOService, UnknownNotification, UnknownResponse } from "../services/stdio_service";
import { reloadExtension } from "../utils";
import { log, LogCategory } from "../utils/log";
import { FlutterDeviceManager } from "./device_manager";
import * as f from "./flutter_types";

export class FlutterDaemon extends StdIOService<UnknownNotification> {
	public deviceManager: FlutterDeviceManager;
	private hasStarted = false;
	private startupReporter: vs.Progress<{ message?: string; increment?: number }>;
	private daemonStartedCompleter = new PromiseCompleter();

	constructor(flutterBinPath: string, projectFolder: string) {
		super(() => config.flutterDaemonLogFile, (message) => log(message, LogCategory.FlutterDaemon), true);

		this.createProcess(projectFolder, flutterBinPath, ["daemon"]);

		this.deviceManager = new FlutterDeviceManager(this);

		// Enable device polling.
		this.deviceEnable().then(() => this.deviceManager.updateStatusBar());
	}

	public get isReady() { return this.hasStarted; }

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
		if (message.startsWith("[") && message.endsWith("]")) {
			if (!this.hasStarted) {
				this.hasStarted = true;
				this.daemonStartedCompleter.resolve();
			}
			return true;
		}
		return false;
	}

	private static readonly outOfDateWarning = new RegExp("WARNING: .* Flutter is (\\d+) days old");
	protected processUnhandledMessage(message: string): void {
		const matches = FlutterDaemon.outOfDateWarning.exec(message);
		if (matches && matches.length === 2) {
			vs.window.showWarningMessage(`Your installation of Flutter is ${matches[1]} days old. To update to the latest version, run 'flutter upgrade'.`);
			return;
		}

		// Show as progress message, this is likely "Building flutter tool" or "downloading Dart SDK" messages.
		if (
			(message.startsWith("Building ") || message.startsWith("Downloading ") || message.startsWith("Starting "))
			&& !message.startsWith("Starting device daemon") // Don't show this one as it happens for normal startups too.
		) {
			if (!this.hasStarted) {
				if (this.startupReporter) {
					this.startupReporter.report({ message });
				} else {
					vs.window.withProgress({
						location: ProgressLocation.Notification,
						title: message,
					}, (progressReporter) => {
						this.startupReporter = progressReporter;
						return this.daemonStartedCompleter.promise;
					});
				}
			}
		}
	}

	// TODO: Can we code-gen all this like the analysis server?

	protected handleNotification(evt: UnknownNotification) {
		switch (evt.event) {
			case "daemon.connected":
				const params = evt.params as f.DaemonConnected;
				this.additionalPidsToTerminate.push(params.pid);
				break;
			case "device.added":
				this.notify(this.deviceAddedSubscriptions, evt.params as f.Device);
				break;
			case "device.removed":
				this.notify(this.deviceRemovedSubscriptions, evt.params as f.Device);
				break;
			case "daemon.logMessage":
				this.notify(this.daemonLogMessageSubscriptions, evt.params as f.LogMessage);
				break;
			case "daemon.showMessage":
				this.notify(this.daemonShowMessageSubscriptions, evt.params as f.ShowMessage);
				break;
		}
	}

	// Subscription lists.

	private deviceAddedSubscriptions: Array<(notification: f.Device) => void> = [];
	private deviceRemovedSubscriptions: Array<(notification: f.Device) => void> = [];
	private daemonLogMessageSubscriptions: Array<(notification: f.LogMessage) => void> = [];
	private daemonShowMessageSubscriptions: Array<(notification: f.ShowMessage) => void> = [];

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

	public registerForDaemonLogMessage(subscriber: (notification: f.LogMessage) => void): vs.Disposable {
		return this.subscribe(this.daemonLogMessageSubscriptions, subscriber);
	}

	public registerForDaemonShowMessage(subscriber: (notification: f.ShowMessage) => void): vs.Disposable {
		return this.subscribe(this.daemonShowMessageSubscriptions, subscriber);
	}
}
