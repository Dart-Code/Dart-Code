import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vs from "vscode";
import { window, workspace } from "vscode";
import { CHROME_OS_DEVTOOLS_PORT, isChromeOS, pubPath } from "../../shared/constants";
import { FlutterService, LogCategory } from "../../shared/enums";
import { Logger, Sdks } from "../../shared/interfaces";
import { CategoryLogger } from "../../shared/logging";
import { UnknownNotification } from "../../shared/services/interfaces";
import { getRandomInt } from "../../shared/utils/fs";
import { waitFor } from "../../shared/utils/promises";
import { showDevToolsNotificationIfAppropriate } from "../../shared/vscode/user_prompts";
import { isRunningLocally } from "../../shared/vscode/utils";
import { Context } from "../../shared/vscode/workspace";
import { Analytics } from "../analytics";
import { DebugCommands, debugSessions } from "../commands/debug";
import { config } from "../config";
import { DebuggerType } from "../providers/debug_config_provider";
import { PubGlobal } from "../pub/global";
import { StdIOService } from "../services/stdio_service";
import { DartDebugSessionInformation } from "../utils/vscode/debug";
import { envUtils } from "../utils/vscode/editor";

const devtools = "devtools";
const devtoolsPackageName = "Dart DevTools";

// This starts off undefined, which means we'll read from config.devToolsPort and all back to 0 (auto-assign).
// Once we get a port we'll update this variable so that if we restart (eg. a silent extension restart due to
// SDK change or similar) we will try to use the same port, so if the user has browser windows open they're
// still valid.
let portToBind: number | undefined;

/// Handles launching DevTools in the browser and managing the underlying service.
export class DevToolsManager implements vs.Disposable {
	private readonly disposables: vs.Disposable[] = [];
	private readonly devToolsStatusBarItem = vs.window.createStatusBarItem(vs.StatusBarAlignment.Right, 100);

	/// Resolves to the DevTools URL. This is created immediately when a new process is being spawned so that
	/// concurrent launches can wait on the same promise.
	private devtoolsUrl: Thenable<string> | undefined;

	constructor(private logger: Logger, private readonly context: Context, private sdks: Sdks, private debugCommands: DebugCommands, private analytics: Analytics, private pubGlobal: PubGlobal) {
		this.disposables.push(this.devToolsStatusBarItem);
	}

	/// Spawns DevTools and returns the full URL to open for that session
	///   eg. http://127.0.0.1:8123/?port=8543
	public async spawnForSession(session: DartDebugSessionInformation & { vmServiceUri: string }, reuseWindows: boolean, notify: boolean): Promise<{ url: string, dispose: () => void } | undefined> {
		this.analytics.logDebuggerOpenDevTools();

		const isAvailable = await this.pubGlobal.promptToInstallIfRequired(devtoolsPackageName, devtools, undefined, "0.1.0", true);
		if (!isAvailable) {
			return undefined;
		}

		if (!this.devtoolsUrl) {
			this.devtoolsUrl = vs.window.withProgress({
				location: vs.ProgressLocation.Notification,
				title: "Starting Dart DevTools...",
			}, async (_) => this.startServer());
		}
		try {
			const url = await this.devtoolsUrl;
			await vs.window.withProgress({
				location: vs.ProgressLocation.Notification,
				title: "Opening Dart DevTools...",
			}, async (_) => {
				const queryParams: { [key: string]: string | undefined } = {
					hide: "debugger",
					ide: "VSCode",
					theme: config.useDevToolsDarkTheme ? "dark" : undefined,
				};
				const canLaunchDevToolsThroughService = isRunningLocally
					&& !process.env.DART_CODE_IS_TEST_RUN
					&& await waitFor(() => this.debugCommands.flutterExtensions.serviceIsRegistered(FlutterService.LaunchDevTools), 500);
				if (canLaunchDevToolsThroughService) {
					try {
						await session.session.customRequest(
							"service",
							{
								params: {
									notify,
									queryParams,
									reuseWindows,
								},
								type: this.debugCommands.flutterExtensions.getServiceMethodName(FlutterService.LaunchDevTools),
							},
						);

						return true;
					} catch (e) {
						this.logger.error(`DevTools failed to launch Chrome, will launch default browser locally instead: ${e.message}`);
						vs.window.showWarningMessage(`Dart DevTools was unable to launch Chrome so your default browser was launched instead.`, "Show Full Error").then((res) => {
							if (res) {
								const fileName = `bug-${getRandomInt(0x1000, 0x10000).toString(16)}.txt`;
								const tempPath = path.join(os.tmpdir(), fileName);
								fs.writeFileSync(tempPath, e.message || e);
								workspace.openTextDocument(tempPath).then((document) => {
									window.showTextDocument(document);
								});
							}
						});
					}
				}

				const paramsString = Object.keys(queryParams)
					.filter((key) => queryParams[key] !== undefined)
					.map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(queryParams[key]!)}`)
					.join("&");
				const fullUrl = `${url}?${paramsString}&uri=${encodeURIComponent(session.vmServiceUri)}`;
				await envUtils.openInBrowser(fullUrl);
			});

			this.devToolsStatusBarItem.text = "Dart DevTools";
			this.devToolsStatusBarItem.tooltip = `Dart DevTools is running at ${url}`;
			this.devToolsStatusBarItem.command = "dart.openDevTools";
			this.devToolsStatusBarItem.show();
			return { url, dispose: () => this.dispose() };
		} catch (e) {
			this.devToolsStatusBarItem.hide();
			this.logger.error(e);
			vs.window.showErrorMessage(`${e}`);
		}
	}

	/// Starts the devtools server and returns the URL of the running app.
	private startServer(): Promise<string> {
		return new Promise<string>((resolve, reject) => {
			const service = new DevToolsService(this.logger, this.sdks);
			this.disposables.push(service);

			service.registerForServerStarted((n) => {
				// When a new debug session starts, we need to wait for its VM
				// Service, then register it with this server.
				this.disposables.push(this.debugCommands.onDebugSessionVmServiceAvailable((session) => {
					service.vmRegister({ uri: session.vmServiceUri! });

					// Open or prompt for DevTools when appropriate.
					const debuggerType: DebuggerType = session.session.configuration.debuggerType;
					if (debuggerType === DebuggerType.Dart || debuggerType === DebuggerType.Flutter || debuggerType === DebuggerType.FlutterWeb) {
						if (config.openDevTools !== "never") {
							const shouldLaunch = debuggerType !== DebuggerType.Dart || config.openDevTools === "always";
							if (shouldLaunch)
								vs.commands.executeCommand("dart.openDevTools", { debugSessionId: session.session.id, triggeredAutomatically: true });
						} else if (debuggerType !== DebuggerType.Dart) {
							// TODO: Add a button to this to "launch always" (behind a flag for now?)
							showDevToolsNotificationIfAppropriate(this.context);
						}
					}
				}));

				// And send any existing sessions we have.
				for (const session of debugSessions) {
					if (session.vmServiceUri)
						service.vmRegister({ uri: session.vmServiceUri });
				}

				portToBind = n.port;
				resolve(`http://${n.host}:${n.port}/`);
			});

			service.process!.on("close", (code) => {
				this.devtoolsUrl = undefined;
				this.devToolsStatusBarItem.hide();
				if (code && code !== 0) {
					// Reset the port to 0 on error in case it was from us trying to reuse the previous port.
					portToBind = 0;
					const errorMessage = `${devtoolsPackageName} exited with code ${code}`;
					this.logger.error(errorMessage);
					reject(errorMessage);
				}
			});
		});
	}

	public dispose(): any {
		this.disposables.forEach((d) => d.dispose());
	}
}

class DevToolsService extends StdIOService<UnknownNotification> {
	constructor(logger: Logger, sdks: Sdks) {
		super(new CategoryLogger(logger, LogCategory.DevTools), config.maxLogLineLength);

		const pubBinPath = path.join(sdks.dart!, pubPath);
		portToBind = config.devToolsPort // Always config first
			|| portToBind                // Then try the last port we bound this session
			|| (isChromeOS && config.useKnownChromeOSPorts ? CHROME_OS_DEVTOOLS_PORT : 0);
		const args = ["global", "run", "devtools", "--machine", "--port", portToBind.toString()];

		this.registerForServerStarted((n) => this.additionalPidsToTerminate.push(n.pid));

		this.createProcess(undefined, pubBinPath, args);
	}

	protected shouldHandleMessage(message: string): boolean {
		return message.startsWith("{") && message.endsWith("}");
	}

	// TODO: Remove this if we fix the DevTools server (and rev min version) to not use method for
	// the server.started event.
	protected isNotification(msg: any): boolean { return msg.event || msg.method === "server.started"; }

	protected handleNotification(evt: UnknownNotification): void {
		switch ((evt as any).method || evt.event) {
			case "server.started":
				this.notify(this.serverStartedSubscriptions, evt.params as ServerStartedNotification);
				break;

		}
	}

	private serverStartedSubscriptions: Array<(notification: ServerStartedNotification) => void> = [];

	public registerForServerStarted(subscriber: (notification: ServerStartedNotification) => void): vs.Disposable {
		return this.subscribe(this.serverStartedSubscriptions, subscriber);
	}

	public vmRegister(request: { uri: string }): Thenable<any> {
		return this.sendRequest("vm.register", request);
	}
}

export interface ServerStartedNotification {
	host: string;
	port: number;
	pid: number;
}
