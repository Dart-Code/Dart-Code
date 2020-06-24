import * as path from "path";
import * as vs from "vscode";
import { ProgressLocation } from "vscode";
import { DaemonCapabilities } from "../../shared/capabilities/flutter";
import { flutterPath, isChromeOS } from "../../shared/constants";
import { LogCategory } from "../../shared/enums";
import * as f from "../../shared/flutter/daemon_interfaces";
import { FlutterWorkspaceContext, IFlutterDaemon, Logger } from "../../shared/interfaces";
import { CategoryLogger, logProcess } from "../../shared/logging";
import { UnknownNotification, UnknownResponse } from "../../shared/services/interfaces";
import { StdIOService } from "../../shared/services/stdio_service";
import { PromiseCompleter, usingCustomScript } from "../../shared/utils";
import { config } from "../config";
import { FLUTTER_SUPPORTS_ATTACH } from "../extension";
import { promptToReloadExtension } from "../utils";
import { getGlobalFlutterArgs, getToolEnv, safeToolSpawn } from "../utils/processes";

export class FlutterDaemon extends StdIOService<UnknownNotification> implements IFlutterDaemon {
	private hasStarted = false;
	private startupReporter: vs.Progress<{ message?: string; increment?: number }> | undefined;
	private daemonStartedCompleter = new PromiseCompleter();
	public capabilities: DaemonCapabilities = DaemonCapabilities.empty;

	constructor(logger: Logger, workspaceContext: FlutterWorkspaceContext) {
		super(new CategoryLogger(logger, LogCategory.FlutterDaemon), config.maxLogLineLength, true);

		const folder = workspaceContext.sdks.flutter;

		this.registerForDaemonConnected((e) => {
			this.additionalPidsToTerminate.push(e.pid);
			this.capabilities.version = e.version;
			vs.commands.executeCommand("setContext", FLUTTER_SUPPORTS_ATTACH, this.capabilities.canFlutterAttach);

			this.deviceEnable();
		});

		const { binPath, binArgs } = usingCustomScript(
			path.join(workspaceContext.sdks.flutter, flutterPath),
			["daemon"],
			{ customScript: workspaceContext.config?.flutterDaemonScript },
		);

		const flutterAdditionalArgs = config.for(vs.Uri.file(folder)).flutterAdditionalArgs;
		const args = getGlobalFlutterArgs().concat(flutterAdditionalArgs).concat(binArgs);
		this.createProcess(folder, binPath, args, { toolEnv: getToolEnv() });

		if (isChromeOS && config.flutterAdbConnectOnChromeOs) {
			logger.info("Running ADB Connect on Chrome OS");
			const adbConnectProc = safeToolSpawn(undefined, "adb", ["connect", "100.115.92.2:5555"]);
			logProcess(logger, LogCategory.General, adbConnectProc);

		}
	}

	public dispose() {
		super.dispose();
	}

	protected sendMessage<T>(json: string) {
		try {
			super.sendMessage(json);
		} catch (e) {
			// tslint:disable-next-line: no-floating-promises
			promptToReloadExtension("The Flutter Daemon has terminated.", undefined, true);
			throw e;
		}
	}

	protected shouldHandleMessage(message: string): boolean {
		// Everything in flutter is wrapped in [] so we can tell what to handle.
		if (message.startsWith("[{") && message.endsWith("}]")) {
			// When we get the first message to handle, complete the status notifications.
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
	private hasShownStartupError = false;
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

		if (!this.hasShownStartupError && message.startsWith("Flutter requires")) {
			this.logger.error(message, LogCategory.FlutterDaemon);
			vs.window.showErrorMessage(message);
			this.hasShownStartupError = true;
			return;
		}

		// Show as progress message, this is likely "Building flutter tool" or "downloading Dart SDK" messages.
		if (
			(message.startsWith("Building ") || message.startsWith("Downloading ") || message.startsWith("Starting ") || message.startsWith("Running "))
			&& !message.startsWith("Starting device daemon") // Don't show this one as it happens for normal startups too.
		) {
			if (!this.hasStarted) {
				if (this.startupReporter) {
					this.startupReporter.report({ message });
				} else {
					vs.window.withProgress({
						location: ProgressLocation.Notification,
						title: "Flutter Setup",
					}, (progressReporter) => {
						this.startupReporter = progressReporter;
						this.startupReporter.report({ message });
						return this.daemonStartedCompleter.promise;
					});
				}
			}
		}
	}

	// TODO: Can we code-gen all this like the analysis server?

	protected async handleNotification(evt: UnknownNotification): Promise<void> {
		switch (evt.event) {
			case "daemon.connected":
				await this.notify(this.daemonConnectedSubscriptions, evt.params as f.DaemonConnected);
				break;
			case "device.added":
				await this.notify(this.deviceAddedSubscriptions, evt.params as f.Device);
				break;
			case "device.removed":
				await this.notify(this.deviceRemovedSubscriptions, evt.params as f.Device);
				break;
			case "daemon.logMessage":
				await this.notify(this.daemonLogMessageSubscriptions, evt.params as f.DaemonLogMessage);
				break;
			case "daemon.log":
				await this.notify(this.daemonLogSubscriptions, evt.params as f.DaemonLog);
				break;
			case "daemon.showMessage":
				await this.notify(this.daemonShowMessageSubscriptions, evt.params as f.ShowMessage);
				break;
		}
	}

	// Subscription lists.

	private daemonConnectedSubscriptions: Array<(notification: f.DaemonConnected) => void> = [];
	private deviceAddedSubscriptions: Array<(notification: f.Device) => void> = [];
	private deviceRemovedSubscriptions: Array<(notification: f.Device) => void> = [];
	private daemonLogMessageSubscriptions: Array<(notification: f.DaemonLogMessage) => void> = [];
	private daemonLogSubscriptions: Array<(notification: f.DaemonLog) => void> = [];
	private daemonShowMessageSubscriptions: Array<(notification: f.ShowMessage) => void> = [];

	// Request methods.

	public deviceEnable(): Thenable<UnknownResponse> {
		return this.sendRequest("device.enable");
	}

	public getEmulators(): Thenable<f.FlutterEmulator[]> {
		return this.sendRequest("emulator.getEmulators");
	}

	public launchEmulator(emulatorId: string): Thenable<void> {
		return this.sendRequest("emulator.launch", { emulatorId });
	}

	public createEmulator(name?: string): Thenable<{ success: boolean, emulatorName: string, error: string }> {
		return this.sendRequest("emulator.create", { name });
	}

	public getSupportedPlatforms(projectRoot: string): Thenable<f.SupportedPlatformsResponse> {
		return this.sendRequest("daemon.getSupportedPlatforms", { projectRoot });
	}

	// Subscription methods.

	public registerForDaemonConnected(subscriber: (notification: f.DaemonConnected) => void): vs.Disposable {
		return this.subscribe(this.daemonConnectedSubscriptions, subscriber);
	}

	public registerForDeviceAdded(subscriber: (notification: f.Device) => void): vs.Disposable {
		return this.subscribe(this.deviceAddedSubscriptions, subscriber);
	}

	public registerForDeviceRemoved(subscriber: (notification: f.Device) => void): vs.Disposable {
		return this.subscribe(this.deviceRemovedSubscriptions, subscriber);
	}

	public registerForDaemonLogMessage(subscriber: (notification: f.DaemonLogMessage) => void): vs.Disposable {
		return this.subscribe(this.daemonLogMessageSubscriptions, subscriber);
	}

	public registerForDaemonLog(subscriber: (notification: f.DaemonLog) => void): vs.Disposable {
		return this.subscribe(this.daemonLogSubscriptions, subscriber);
	}

	public registerForDaemonShowMessage(subscriber: (notification: f.ShowMessage) => void): vs.Disposable {
		return this.subscribe(this.daemonShowMessageSubscriptions, subscriber);
	}
}
