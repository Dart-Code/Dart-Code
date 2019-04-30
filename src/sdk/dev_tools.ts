import * as path from "path";
import * as vs from "vscode";
import { Analytics } from "../analytics";
import { DebugCommands, debugSessions } from "../commands/debug";
import { config } from "../config";
import { CHROME_OS_DEVTOOLS_PORT, pleaseReportBug } from "../constants";
import { isChromeOS, LogCategory } from "../debug/utils";
import { FlutterService } from "../flutter/vm_service_extensions";
import { PubGlobal } from "../pub/global";
import { StdIOService, UnknownNotification } from "../services/stdio_service";
import { Sdks } from "../utils";
import { log, logError } from "../utils/log";
import { waitFor } from "../utils/promises";
import { DartDebugSessionInformation } from "../utils/vscode/debug";
import { pubPath } from "./utils";

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

	constructor(private sdks: Sdks, private debugCommands: DebugCommands, private analytics: Analytics, private pubGlobal: PubGlobal) {
		this.disposables.push(this.devToolsStatusBarItem);
	}

	/// Spawns DevTools and returns the full URL to open for that session
	///   eg. http://localhost:8123/?port=8543
	public async spawnForSession(session: DartDebugSessionInformation): Promise<{ url: string, dispose: () => void } | undefined> {
		this.analytics.logDebuggerOpenDevTools();

		const isAvailable = await this.pubGlobal.promptToInstallIfRequired(devtoolsPackageName, devtools, undefined, "0.0.17", true);
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
			const didLaunch = await vs.window.withProgress({
				location: vs.ProgressLocation.Notification,
				title: "Opening Dart DevTools...",
			}, async (_) => {
				const canLaunchDevToolsThroughService = await waitFor(() => this.debugCommands.flutterExtensions.serviceIsRegistered(FlutterService.LaunchDevTools), 500);
				if (canLaunchDevToolsThroughService) {
					await session.session.customRequest(
						"service",
						{
							params: {
								queryParams: {
									hide: "debugger",
									theme: config.useDevToolsDarkTheme ? "dark" : null,
								},
							},
							type: this.debugCommands.flutterExtensions.getServiceMethodName(FlutterService.LaunchDevTools),
						},
					);
					return true;
				} else {
					// const fullUrl = `${url}?hide=debugger&uri=${encodeURIComponent(session.vmServiceUri)}${config.useDevToolsDarkTheme ? "&theme=dark" : ""}`;
					// openInBrowser(fullUrl);
					logError(`DevTools failed to register launchDevTools service`);
					vs.window.showErrorMessage(`The DevTools service failed to register. ${pleaseReportBug}`);
					return false;
				}
			});
			if (!didLaunch)
				return;
			this.devToolsStatusBarItem.text = "Dart DevTools";
			this.devToolsStatusBarItem.tooltip = `Dart DevTools is running at ${url}`;
			this.devToolsStatusBarItem.command = "dart.openDevTools";
			this.devToolsStatusBarItem.show();
			return { url, dispose: () => this.dispose() };
		} catch (e) {
			this.devToolsStatusBarItem.hide();
			logError(e);
			vs.window.showErrorMessage(`${e}`);
		}
	}

	/// Starts the devtools server and returns the URL of the running app.
	private startServer(): Promise<string> {
		return new Promise<string>((resolve, reject) => {
			const service = new DevToolsService(this.sdks);
			this.disposables.push(service);

			service.registerForServerStarted((n) => {
				// When a new debug session starts, we need to wait for its VM
				// Service, then register it with this server.
				this.disposables.push(this.debugCommands.onDebugSessionVmServiceAvailable(
					(session) => service.vmRegister({ uri: session.vmServiceUri }),
				));

				// And send any existing sessions we have.
				debugSessions.forEach(
					(session) => service.vmRegister({ uri: session.vmServiceUri }),
				);

				portToBind = n.port;
				resolve(`http://${n.host}:${n.port}`);
			});

			service.process.on("close", (code) => {
				this.devtoolsUrl = undefined;
				this.devToolsStatusBarItem.hide();
				if (code && code !== 0) {
					// Reset the port to 0 on error in case it was from us trying to reuse the previous port.
					portToBind = 0;
					const errorMessage = `${devtoolsPackageName} exited with code ${code}`;
					logError(errorMessage);
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
	constructor(sdks: Sdks) {
		super(() => config.devToolsLogFile, (message, severity) => log(message, severity, LogCategory.CommandProcesses), config.maxLogLineLength);

		const pubBinPath = path.join(sdks.dart, pubPath);
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
