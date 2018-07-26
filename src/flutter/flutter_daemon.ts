import * as vs from "vscode";
import { ProgressLocation } from "vscode";
import { config } from "../config";
import { LogCategory, PromiseCompleter } from "../debug/utils";
import { StdIOService, UnknownNotification, UnknownResponse } from "../services/stdio_service";
import { reloadExtension, versionIsAtLeast } from "../utils";
import { log } from "../utils/log";
import { FlutterDeviceManager } from "./device_manager";
import * as f from "./flutter_types";

export class DaemonCapabilities {
	public static get empty() { return new DaemonCapabilities("0.0.0"); }

	public version: string;

	constructor(daemonProtocolVersion: string) {
		this.version = daemonProtocolVersion;
	}

	get canCreateEmulators() { return versionIsAtLeast(this.version, "0.4.0"); }

	// TODO: Remove this after the next beta update. We have some flakes (flutter run tests)
	// due to the test device not starting up properly. Never seen on master, so assumed to be an
	// issue that's been fixed. If not we'll see new failures despite this and can investigate further.
	get flutterTesterMayBeFlaky() { return !versionIsAtLeast(this.version, "0.4.0"); }
}

export class FlutterDaemon extends StdIOService<UnknownNotification> {
	public deviceManager: FlutterDeviceManager;
	private hasStarted = false;
	private startupReporter: vs.Progress<{ message?: string; increment?: number }>;
	private daemonStartedCompleter = new PromiseCompleter();
	public capabilities: DaemonCapabilities = DaemonCapabilities.empty;

	constructor(flutterBinPath: string, projectFolder: string) {
		super(() => config.flutterDaemonLogFile, (message, severity) => log(message, severity, LogCategory.FlutterDaemon), config.maxLogLineLength, true);

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
			reloadExtension("The Flutter Daemon has terminated.", undefined, true);
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
	private static readonly newVersionMessage = "A new version of Flutter is available";
	protected async processUnhandledMessage(message: string): Promise<void> {
		let upgradeMessage: string | undefined;
		const matches = FlutterDaemon.outOfDateWarning.exec(message);
		if (matches && matches.length === 2)
			upgradeMessage = `Your installation of Flutter is ${matches[1]} days old.`;
		else if (message.indexOf(FlutterDaemon.newVersionMessage) !== -1)
			upgradeMessage = "A new version of Flutter is available";

		if (upgradeMessage) {
			if (await vs.window.showWarningMessage(upgradeMessage, "Upgrade Flutter"))
				vs.commands.executeCommand("flutter.upgrade");
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
				this.capabilities.version = params.version;
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

	public createEmulator(name?: string): Thenable<{ success: boolean, emulatorName: string, error: string }> {
		return this.sendRequest("emulator.create", { name });
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
