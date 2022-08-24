import * as child_process from "child_process";
import * as path from "path";
import * as vs from "vscode";
import { ProgressLocation } from "vscode";
import { DaemonCapabilities, FlutterCapabilities } from "../../shared/capabilities/flutter";
import { flutterPath, isChromeOS } from "../../shared/constants";
import { LogCategory } from "../../shared/enums";
import * as f from "../../shared/flutter/daemon_interfaces";
import { FlutterWorkspaceContext, IFlutterDaemon, Logger, SpawnedProcess } from "../../shared/interfaces";
import { CategoryLogger, logProcess } from "../../shared/logging";
import { UnknownNotification, UnknownResponse } from "../../shared/services/interfaces";
import { StdIOService } from "../../shared/services/stdio_service";
import { PromiseCompleter, usingCustomScript } from "../../shared/utils";
import { isRunningLocally } from "../../shared/vscode/utils";
import { config } from "../config";
import { FLUTTER_SUPPORTS_ATTACH } from "../extension";
import { promptToReloadExtension } from "../utils";
import { getFlutterConfigValue } from "../utils/misc";
import { getGlobalFlutterArgs, getToolEnv, runToolProcess, safeToolSpawn } from "../utils/processes";

export class FlutterDaemon extends StdIOService<UnknownNotification> implements IFlutterDaemon {
	private hasStarted = false;
	private hasShownTerminationError = false;
	private isShuttingDown = false;
	private startupReporter: vs.Progress<{ message?: string; increment?: number }> | undefined;
	private daemonStartedCompleter = new PromiseCompleter<void>();
	public capabilities: DaemonCapabilities = DaemonCapabilities.empty;

	constructor(logger: Logger, private readonly workspaceContext: FlutterWorkspaceContext, flutterCapabilities: FlutterCapabilities, private readonly runIfNoDevices?: () => void) {
		super(new CategoryLogger(logger, LogCategory.FlutterDaemon), config.maxLogLineLength, true, true);

		const folder = workspaceContext.sdks.flutter;

		this.registerForDaemonConnected((e) => {
			this.additionalPidsToTerminate.push(e.pid);
			this.capabilities.version = e.version;
			vs.commands.executeCommand("setContext", FLUTTER_SUPPORTS_ATTACH, this.capabilities.canFlutterAttach);

			this.deviceEnable();
		});

		const daemonArgs = [];

		const showWebServer = config.flutterShowWebServerDevice === "always" || !isRunningLocally;
		if (showWebServer && flutterCapabilities.supportsShowWebServerDevice)
			daemonArgs.push("--show-web-server-device");

		if (process.env.DART_CODE_IS_TEST_RUN)
			daemonArgs.push("--show-test-device");


		if (workspaceContext.config.forceFlutterWorkspace && config.daemonPort) {
			this.createNcProcess(config.daemonPort);
		} else {
			const execution = usingCustomScript(
				path.join(workspaceContext.sdks.flutter, flutterPath),
				["daemon"].concat(daemonArgs),
				workspaceContext.config?.flutterDaemonScript,
			);

			const flutterAdditionalArgs = config.for(vs.Uri.file(folder)).flutterAdditionalArgs;
			const args = getGlobalFlutterArgs().concat(flutterAdditionalArgs).concat(execution.args);
			this.createProcess(folder, execution.executable, args, { toolEnv: getToolEnv() });
		}

		if (isChromeOS && config.flutterAdbConnectOnChromeOs) {
			logger.info("Running ADB Connect on Chrome OS");
			const adbConnectProc = safeToolSpawn(undefined, "adb", ["connect", "100.115.92.2:5555"]);
			logProcess(logger, LogCategory.General, adbConnectProc);

		}
	}

	// This is for the case where a user has started a flutter daemon process on their local machine where devices are available, and
	// has forwarded this port to the remote machine where the Dart extension is running. Netcat is used to access the local devices,
	// instead of starting another daemon process on the remote machine.
	protected createNcProcess(port: number) {
		this.process = child_process.spawn("nc", ["localhost", port.toString()]) as SpawnedProcess;

		this.process.stdout.on("data", (data: Buffer | string) => this.handleStdOut(data));
		this.process.stderr.on("data", (data: Buffer | string) => this.handleStdErr(data));
		this.process.on("exit", (code, signal) => this.handleExit(code, signal));
		this.process.on("error", (error) => {
			vs.window.showErrorMessage(`Remote daemon startup had an error: ${error}. Check the instructions for using dart.daemonPort`);
			this.handleError(error);
		});
	}

	protected handleExit(code: number | null, signal: NodeJS.Signals | null) {
		if (code && !this.hasShownTerminationError && !this.isShuttingDown) {
			if (this.runIfNoDevices) {
				this.runIfNoDevices();
			} else {
				this.hasShownTerminationError = true;
				const message = this.hasStarted ? "has terminated" : "failed to start";
				// tslint:disable-next-line: no-floating-promises
				promptToReloadExtension(`The Flutter Daemon ${message}.`, undefined, true);
			}
		}
		super.handleExit(code, signal);
	}

	public dispose() {
		this.isShuttingDown = true;
		super.dispose();
	}

	protected sendMessage<T>(json: string) {
		try {
			super.sendMessage(json);
		} catch (e) {
			if (!this.hasShownTerminationError && !this.isShuttingDown) {
				this.hasShownTerminationError = true;
				// tslint:disable-next-line: no-floating-promises
				promptToReloadExtension("The Flutter Daemon has terminated.", undefined, true);
				throw e;
			}
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

	public async enablePlatformGlobally(platformType: string): Promise<void> {
		const flutterSdkPath = this.workspaceContext.sdks.flutter;
		const binPath = path.join(flutterSdkPath, flutterPath);
		const args = ["config", `--enable-${platformType}`];
		await runToolProcess(this.logger, flutterSdkPath, binPath, args);
	}

	public async checkIfPlatformGloballyDisabled(platformType: string): Promise<boolean> {
		const flutterSdkPath = this.workspaceContext.sdks.flutter;
		const value = await getFlutterConfigValue(this.logger, flutterSdkPath, flutterSdkPath, `enable-${platformType}`);
		// Only consider it disabled if it's specifically false (if it's not present, don't assume).
		return value === false;
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

	public launchEmulator(emulatorId: string, coldBoot: boolean): Thenable<void> {
		return this.sendRequest("emulator.launch", { emulatorId, coldBoot });
	}

	public createEmulator(name?: string): Thenable<{ success: boolean, emulatorName: string, error: string }> {
		return this.sendRequest("emulator.create", { name });
	}

	public getSupportedPlatforms(projectRoot: string): Thenable<f.SupportedPlatformsResponse> {
		return this.sendRequest("daemon.getSupportedPlatforms", { projectRoot });
	}

	public serveDevTools(): Thenable<f.ServeDevToolsResponse> {
		return this.sendRequest("devtools.serve");
	}

	public shutdown(): Thenable<void> {
		return this.hasStarted ? this.sendRequest("daemon.shutdown") : new Promise<void>((resolve) => resolve());
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
