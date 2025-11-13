import * as child_process from "child_process";
import * as path from "path";
import * as vs from "vscode";
import { ProgressLocation } from "vscode";
import { DaemonCapabilities, FlutterCapabilities } from "../../shared/capabilities/flutter";
import { ExtensionRestartReason, flutterPath, isChromeOS, isDartCodeTestRun, isMac, tenMinutesInMs, twentySecondsInMs } from "../../shared/constants";
import { FLUTTER_SUPPORTS_ATTACH } from "../../shared/constants.contexts";
import { LogCategory } from "../../shared/enums";
import * as f from "../../shared/flutter/daemon_interfaces";
import { FlutterWorkspaceContext, IFlutterDaemon, Logger, SpawnedProcess } from "../../shared/interfaces";
import { CategoryLogger, logProcess } from "../../shared/logging";
import { UnknownNotification, UnknownResponse } from "../../shared/services/interfaces";
import { StdIOService } from "../../shared/services/stdio_service";
import { PromiseCompleter, usingCustomScript, withTimeout } from "../../shared/utils";
import { isDevExtension, isPreReleaseExtension } from "../../shared/vscode/extension_utils";
import { isRunningLocally } from "../../shared/vscode/utils";
import { Analytics } from "../analytics";
import { config } from "../config";
import { promptToReloadExtension } from "../utils";
import { getFlutterConfigValue } from "../utils/misc";
import { getGlobalFlutterArgs, getToolEnv, runToolProcess, safeToolSpawn } from "../utils/processes";

export class FlutterDaemon extends StdIOService<UnknownNotification> implements IFlutterDaemon {
	private startTime: Date | undefined;
	private get hasStarted() { return !!this.startTime; };
	private hasShownTerminatedError = false;
	private hasLoggedDaemonTimeout = false;
	private isShuttingDown = false;
	private startupReporter: vs.Progress<{ message?: string; increment?: number }> | undefined;
	private daemonStartedCompleter = new PromiseCompleter<void>();
	public daemonStarted = this.daemonStartedCompleter.promise;
	private pingIntervalId?: NodeJS.Timeout;
	public capabilities: DaemonCapabilities = DaemonCapabilities.empty;

	constructor(logger: Logger, private readonly analytics: Analytics, private readonly workspaceContext: FlutterWorkspaceContext, flutterCapabilities: FlutterCapabilities, private readonly runIfNoDevices?: () => void, portFromLocalExtension?: number) {
		super(new CategoryLogger(logger, LogCategory.FlutterDaemon), config.maxLogLineLength, true, true);

		const folder = workspaceContext.sdks.flutter;

		this.registerForDaemonConnected((e) => {
			this.additionalPidsToTerminate.push(e.pid);
			this.capabilities.version = e.version;
			void vs.commands.executeCommand("setContext", FLUTTER_SUPPORTS_ATTACH, this.capabilities.canFlutterAttach);

			void this.deviceEnable();
		});

		const daemonArgs = [];

		const showWebServer = config.flutterShowWebServerDevice === "always" || !isRunningLocally;
		if (showWebServer)
			daemonArgs.push("--show-web-server-device");

		if (isDartCodeTestRun)
			daemonArgs.push("--show-test-device");

		if (portFromLocalExtension) {
			this.createNcProcess(portFromLocalExtension);
			this.startPing();
		} else if (workspaceContext.config.forceFlutterWorkspace && config.daemonPort) {
			this.createNcProcess(config.daemonPort);
			this.startPing(workspaceContext.config.restartMacDaemonMessage);
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

	public startPing(customMessage?: string) {
		const prompt = customMessage ?? "The daemon connection was lost. Reload the extension to restart the daemon.";
		this.pingIntervalId = setInterval(async () => {
			try {
				await withTimeout(this.daemonVersion(), "The daemon connection was lost", 10);
			} catch (e) {
				clearInterval(this.pingIntervalId);
				this.logger.error(e);
				this.hasShownTerminatedError = true;
				void promptToReloadExtension(this.logger, { prompt, restartReason: ExtensionRestartReason.FlutterDaemonTerminatedPing });
			}
		}, 60 * 1000);
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
			void vs.window.showErrorMessage(`Remote daemon startup had an error: ${error}. Check the instructions for using dart.daemonPort`);
			this.handleError(error);
		});
	}

	protected handleExit(code: number | null, signal: NodeJS.Signals | null) {
		if (code && !this.isShuttingDown)
			this.handleUncleanExit();

		super.handleExit(code, signal);
	}

	private handleUncleanExit() {
		if (this.runIfNoDevices) {
			this.runIfNoDevices();
		} else if (!this.hasShownTerminatedError) {
			this.showTerminatedError(this.hasStarted ? "has terminated" : "failed to start");
		}
	}

	protected notifyRequestAfterExit() {
		this.showTerminatedError("is not running");
	}

	private lastShownTerminatedError: number | undefined;
	private readonly noRepeatTerminatedErrorThresholdMs = tenMinutesInMs;
	private showTerminatedError(message: string) {
		// Don't show this notification if we've shown it recently.
		if (this.lastShownTerminatedError && Date.now() - this.lastShownTerminatedError < this.noRepeatTerminatedErrorThresholdMs)
			return;

		this.lastShownTerminatedError = Date.now();

		// This flag is set here, but checked in handleUncleanExit because explicit calls
		// here can override hasShownTerminationError, for example to show the error when
		// something tries to interact with the API (`notifyRequestAfterExit`).
		this.hasShownTerminatedError = true;
		void promptToReloadExtension(this.logger, {
			prompt: `The Flutter Daemon ${message}.`,
			offerLog: true,
			specificLog: config.flutterDaemonLogFile,
			restartReason: ExtensionRestartReason.FlutterDaemonTerminatedExit,
		});
	}

	public dispose() {
		this.isShuttingDown = true;

		if (this.pingIntervalId) {
			clearInterval(this.pingIntervalId);
		}

		super.dispose();
	}

	protected sendMessage(json: string) {
		try {
			super.sendMessage(json);
		} catch (e) {
			if (!this.hasShownTerminatedError && !this.isShuttingDown) {
				this.hasShownTerminatedError = true;
				void promptToReloadExtension(this.logger, {
					prompt: "The Flutter Daemon has terminated.",
					offerLog: true,
					specificLog: config.flutterDaemonLogFile,
					restartReason: ExtensionRestartReason.FlutterDaemonTerminatedSend,
				});
				throw e;
			}
		}
	}

	protected shouldHandleMessage(message: string): boolean {
		// Everything in flutter is wrapped in [] so we can tell what to handle.
		if (message.startsWith("[{") && message.endsWith("}]")) {
			// When we get the first message to handle, complete the status notifications.
			if (!this.hasStarted) {
				this.startTime = new Date();
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
		else if (message.includes(FlutterDaemon.newVersionMessage))
			upgradeMessage = "A new version of Flutter is available";

		if (upgradeMessage) {
			if (await vs.window.showWarningMessage(upgradeMessage, "Upgrade Flutter"))
				void vs.commands.executeCommand("flutter.upgrade");
			return;
		}

		if (!this.hasShownStartupError && message.startsWith("Flutter requires")) {
			this.logger.error(message, LogCategory.FlutterDaemon);
			void vs.window.showErrorMessage(message);
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
					void vs.window.withProgress({
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

	public daemonVersion(): Thenable<string> {
		return this.sendRequest("daemon.version");
	}

	public deviceEnable(): Thenable<UnknownResponse> {
		return this.sendRequest("device.enable");
	}

	public getEmulators(): Thenable<f.FlutterEmulator[]> {
		return this.withRecordedTimeout("emulator.getEmulators", this.sendRequest("emulator.getEmulators"));
	}

	public launchEmulator(emulatorId: string, coldBoot: boolean): Thenable<void> {
		return this.sendRequest("emulator.launch", { emulatorId, coldBoot });
	}

	public createEmulator(name?: string): Thenable<{ success: boolean, emulatorName: string, error: string }> {
		return this.sendRequest("emulator.create", { name });
	}

	public getSupportedPlatforms(projectRoot: string): Thenable<f.SupportedPlatformsResponse> {
		return this.withRecordedTimeout("daemon.getSupportedPlatforms", this.sendRequest("daemon.getSupportedPlatforms", { projectRoot }));
	}

	public serveDevTools(): Thenable<f.ServeDevToolsResponse> {
		return this.sendRequest("devtools.serve");
	}

	public shutdown(): Thenable<void> {
		this.isShuttingDown = true;
		return this.hasStarted && !this.hasShownTerminatedError ? this.sendRequest("daemon.shutdown") : new Promise<void>((resolve) => resolve());
	}

	private async withRecordedTimeout<T>(requestMethod: string, promise: Thenable<T>): Promise<T> {
		// Don't use timeout unless we haven't shown the message before and we know
		// we have fully started up (so we don't false trigger during slow startups
		// caused by SDK upgrades, etc.).
		const recordTimeouts = this.hasStarted && !this.hasLoggedDaemonTimeout && !this.isShuttingDown && !this.processExited;
		if (!recordTimeouts)
			return promise; // Short-cut creating the timer.

		return new Promise<T>((resolve, reject) => {
			const timeoutMs = twentySecondsInMs;

			// Set a timer to record if the request doesn't respond fast enough.
			const timeoutTimer = setTimeout(() => {
				const uptimeSeconds = this.startTime ? (Date.now() - this.startTime.getTime()) / 1000 : -1;

				// Always write to the log.
				this.logger.error(`Request "${requestMethod}" to daemon was not responded to within ${timeoutMs}ms. Daemon has been up for ${uptimeSeconds}s when this timeout fired."`);

				const recordTimeouts = this.hasStarted && !this.hasLoggedDaemonTimeout && !this.isShuttingDown && !this.processExited;
				if (recordTimeouts) {
					this.analytics.logErrorFlutterDaemonTimeout(requestMethod);
					this.hasLoggedDaemonTimeout = true;

					if ((isDevExtension || isPreReleaseExtension) && isMac) {
						void promptToReloadExtension(this.logger, {
							prompt: `The Flutter daemon did not respond to a request within ${(timeoutMs / 1000).toFixed(0)}s. Please post any "FlutterDaemon" errors from the log to [this GitHub issue](https://github.com/Dart-Code/Dart-Code/issues/5793#issuecomment-3527504661).`,
							offerLog: true,
							severity: "WARNING",
							specificLog: config.flutterDaemonLogFile,
							restartReason: ExtensionRestartReason.FlutterDaemonTimeout
						});
					}
				}
			}, timeoutMs);

			promise.then(
				(result) => {
					clearTimeout(timeoutTimer);
					resolve(result);
				},
				(e) => {
					clearTimeout(timeoutTimer);
					reject(e);
				},
			);
		});
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
