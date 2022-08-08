import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vs from "vscode";
import { window, workspace } from "vscode";
import { DartCapabilities } from "../../../shared/capabilities/dart";
import { FlutterCapabilities } from "../../../shared/capabilities/flutter";
import { vsCodeVersion } from "../../../shared/capabilities/vscode";
import { cpuProfilerPage, dartVMPath, devToolsPages, isDartCodeTestRun, performancePage, reactivateDevToolsAction, skipAction, widgetInspectorPage } from "../../../shared/constants";
import { LogCategory, VmService } from "../../../shared/enums";
import { DartWorkspaceContext, DevToolsPage, IFlutterDaemon, Logger } from "../../../shared/interfaces";
import { CategoryLogger } from "../../../shared/logging";
import { getPubExecutionInfo } from "../../../shared/processes";
import { UnknownNotification } from "../../../shared/services/interfaces";
import { StdIOService } from "../../../shared/services/stdio_service";
import { disposeAll, usingCustomScript } from "../../../shared/utils";
import { getRandomInt } from "../../../shared/utils/fs";
import { waitFor } from "../../../shared/utils/promises";
import { envUtils, isRunningLocally } from "../../../shared/vscode/utils";
import { Analytics } from "../../analytics";
import { DebugCommands, debugSessions, isInFlutterDebugModeDebugSession, isInFlutterProfileModeDebugSession } from "../../commands/debug";
import { config } from "../../config";
import { PubGlobal } from "../../pub/global";
import { getToolEnv } from "../../utils/processes";
import { DartDebugSessionInformation } from "../../utils/vscode/debug";
import { DevToolsEmbeddedView } from "./embedded_view";

const devtoolsPackageID = "devtools";
const devtoolsPackageName = "Dart DevTools";

// This starts off undefined, which means we'll read from config.devToolsPort and fall back to undefined (use default).
// Once we get a port we'll update this variable so that if we restart (eg. a silent extension restart due to
// SDK change or similar) we will try to use the same port, so if the user has browser windows open they're
// still valid.
let portToBind: number | undefined;

/// Handles launching DevTools in the browser and managing the underlying service.
export class DevToolsManager implements vs.Disposable {
	private readonly disposables: vs.Disposable[] = [];
	private readonly devToolsStatusBarItem = vs.window.createStatusBarItem("dartStatusDevTools", vs.StatusBarAlignment.Right, 100);
	private devToolsActivationPromise: Promise<void> | undefined;
	private devToolsEmbeddedViews: { [key: string]: DevToolsEmbeddedView[] | undefined } = {};
	public get devToolsActivation() { return this.devToolsActivationPromise; }
	private service?: DevToolsService;

	/// Resolves to the DevTools URL. This is created immediately when a new process is being spawned so that
	/// concurrent launches can wait on the same promise.
	public devtoolsUrl: Thenable<string> | undefined;

	constructor(private readonly logger: Logger, private readonly workspaceContext: DartWorkspaceContext, private readonly debugCommands: DebugCommands, private readonly analytics: Analytics, private readonly pubGlobal: PubGlobal, private readonly dartCapabilities: DartCapabilities, private readonly flutterCapabilities: FlutterCapabilities, private readonly flutterDaemon: IFlutterDaemon | undefined) {
		this.devToolsStatusBarItem.name = "Dart/Flutter DevTools";
		this.disposables.push(this.devToolsStatusBarItem);

		this.handleEagerActivationAndStartup(workspaceContext);
	}

	private async handleEagerActivationAndStartup(workspaceContext: DartWorkspaceContext) {
		if (workspaceContext.config?.startDevToolsServerEagerly) {
			try {
				if (workspaceContext.config?.startDevToolsServerEagerly) {
					await this.spawnIfRequired(true);
				}
			} catch (e) {
				this.logger.error("Failed to background start DevTools");
				this.logger.error(e);
				vs.window.showErrorMessage(`Failed to start DevTools: ${e}`);
			}

		}
	}

	private async preActivate(silent: boolean): Promise<void> {
		this.devToolsActivationPromise = this.pubGlobal.backgroundActivate(devtoolsPackageName, devtoolsPackageID, silent);
		await this.devToolsActivationPromise;
	}

	private routeIdForPage(page: DevToolsPage | undefined | null): string | undefined {
		if (!page)
			return undefined;

		if (page.routeId)
			return page.routeId(this.flutterCapabilities.version);

		return page.id;
	}

	private async spawnIfRequired(silent = false): Promise<string | undefined> {
		// If we're mid-silent-activation, wait until that's finished.
		await this.devToolsActivationPromise;

		if (!this.devtoolsUrl) {
			this.devToolsStatusBarItem.hide();
			// Ensure the Pub version of DevTools is installed if we're not launching from the daemon or
			// the version from the Dart SDK.
			if (!this.dartCapabilities.supportsDartDevTools) {
				const installedVersion = await this.pubGlobal.installIfRequired({
					moreInfoLink: undefined,
					packageID: devtoolsPackageID,
					packageName: devtoolsPackageName,
					requiredVersion: "0.9.6",
					silent,
					skipOptionalUpdates: !config.updateDevTools,
					updateSilently: true,
				});
				// If install failed, we can't start.
				if (!installedVersion) {
					return undefined;
				}
			}

			// Ignore silent flag if we're using a custom DevTools, because it could
			// take much longer to start and won't be obvious why launching isn't working.
			const isCustomDevTools = !!config.customDevTools?.script;
			const startingTitle = isCustomDevTools ? "Starting Custom Dart DevTools…" : "Starting Dart DevTools…";
			if (silent && !isCustomDevTools) {
				this.devtoolsUrl = this.startServer();
			} else {
				this.devtoolsUrl = vs.window.withProgress({
					location: vs.ProgressLocation.Notification,
					title: startingTitle,
				}, async () => this.startServer());
			}
		}

		const url = await this.devtoolsUrl;

		this.devToolsStatusBarItem.text = "Dart DevTools";
		this.devToolsStatusBarItem.tooltip = `DevTools is running at ${url}`;
		this.devToolsStatusBarItem.command = "dart.openDevTools";
		this.devToolsStatusBarItem.show();

		return url;
	}

	/// Spawns DevTools and returns the full URL to open without a debug session.
	public async spawnForNoSession(): Promise<{ url: string; dispose: () => void } | undefined> {
		this.analytics.logDebuggerOpenDevTools();

		const url = await this.spawnIfRequired();
		if (!url)
			return;

		try {
			envUtils.openInBrowser(url.toString(), this.logger);
		} catch (e) {
			this.showError(e);
		}
	}

	/// Spawns DevTools and returns the full URL to open for that session
	///   eg. http://127.0.0.1:8123/?port=8543
	public async spawnForSession(session: DartDebugSessionInformation & { vmServiceUri: string }, options: DevToolsOptions): Promise<{ url: string; dispose: () => void } | undefined> {
		this.analytics.logDebuggerOpenDevTools();

		const url = await this.spawnIfRequired();
		if (!url)
			return;

		if (options.location === undefined)
			options.location = config.devToolsLocation;
		if (!vsCodeVersion.supportsEmbeddedDevTools)
			options.location = "external";
		if (options.reuseWindows === undefined)
			options.reuseWindows = config.devToolsReuseWindows;

		// When we're running embedded and were asked to open without a page, we should prompt for a page (plus give an option
		// to open non-embedded view).
		if (options.location !== "external" && !options.page) {
			const choice = options.page === null ? "EXTERNAL" : await this.promptForDevToolsPage();
			if (!choice) // User cancelled
				return;
			else if (choice === "EXTERNAL")
				options.location = "external";
			else
				options.page = choice.page;
		}

		try {
			await vs.window.withProgress({
				location: vs.ProgressLocation.Notification,
				title: "Opening DevTools...",
			}, async () => {
				const canLaunchDevToolsThroughService = isRunningLocally
					&& options.location === "external"
					&& !isDartCodeTestRun
					&& config.devToolsBrowser === "chrome"
					&& await waitFor(() => this.debugCommands.vmServices.serviceIsRegistered(VmService.LaunchDevTools), 500);

				await this.launch(!!canLaunchDevToolsThroughService, session, options);
			});

			return { url, dispose: () => this.dispose() };
		} catch (e) {
			this.showError(e);
		}
	}

	private async promptForDevToolsPage(): Promise<{ page: DevToolsPage } | "EXTERNAL" | undefined> {
		const choices: Array<vs.QuickPickItem & { page?: DevToolsPage; isExternal?: boolean }> = [
			...devToolsPages.map((page) => ({
				label: `Open ${page.title} Page`,
				page,
			})),
			{ label: `Open DevTools in Web Browser`, isExternal: true },
		];
		const choice = await vs.window.showQuickPick(choices, { placeHolder: "Which DevTools page?" });
		if (!choice)
			return undefined;
		else if (choice.isExternal)
			return "EXTERNAL";
		else if (choice.page)
			return { page: choice.page };
		else
			return undefined; // Shouldn't get here...
	}

	private showError(e: any) {
		this.logger.error(e);
		vs.window.showErrorMessage(`${e}`);
	}

	/// When a new Debug session starts, we can reconnect any views that are still open
	// in the disconnected state.
	public async reconnectDisconnectedEmbeddedViews(session: DartDebugSessionInformation & { vmServiceUri: string }): Promise<void> {
		if (!this.devtoolsUrl)
			return;

		for (const pageId of Object.keys(this.devToolsEmbeddedViews)) {
			const page = devToolsPages.find((p) => p.id === pageId);
			const panels = this.devToolsEmbeddedViews[pageId];
			if (!panels)
				continue;

			// If there are disconnected panels for this page, trigger a launch
			// of the page to reuse it.
			const reusablePanel = panels.find((p) => p.session.hasEnded);
			if (reusablePanel) {
				reusablePanel.session = session;
				await this.launch(false, session, { location: "beside", page });
			}
		}
	}

	private getDefaultPage(): DevToolsPage {
		return isInFlutterDebugModeDebugSession
			? widgetInspectorPage
			: isInFlutterProfileModeDebugSession
				? performancePage
				: cpuProfilerPage;
	}

	private async launch(allowLaunchThroughService: boolean, session: DartDebugSessionInformation & { vmServiceUri: string }, options: DevToolsOptions) {
		const url = await this.devtoolsUrl;
		if (!url) {
			this.showError(`DevTools URL not available`);
			return;
		}

		const queryParams: { [key: string]: string | undefined } = {
			inspectorRef: options.inspectorRef,
			theme: config.useDevToolsDarkTheme && options.location === "external" ? "dark" : undefined,
		};

		// Try to launch via service if allowed.
		if (allowLaunchThroughService && await this.launchThroughService(session, { ...options, queryParams, page: this.routeIdForPage(options.page ?? this.getDefaultPage()) }))
			return true;

		// Otherwise, fall back to embedded or launching manually.
		if (options.page)
			queryParams.page = this.routeIdForPage(options.page);
		if (options.location !== "external")
			queryParams.embed = "true";
		const fullUrl = await this.buildDevToolsUrl(queryParams, session.vmServiceUri, url);
		if (options.location !== "external") {
			const exposedUrl = await envUtils.exposeUrl(fullUrl);
			this.launchInEmbeddedWebView(exposedUrl, session, options.page ?? devToolsPages[0], options.location);
		} else {
			await envUtils.openInBrowser(fullUrl, this.logger);
		}
	}

	private async buildDevToolsUrl(queryParams: { [key: string]: string | undefined }, vmServiceUri: string, url: string) {
		queryParams.hide = "debugger";
		queryParams.ide = "VSCode";

		// Handle new Path URL DevTools.
		let path = "";
		if (this.dartCapabilities.supportsDartDevToolsPathUrls) {
			path = queryParams.page ?? "";
			delete queryParams.page;
		}

		const paramsString = Object.keys(queryParams)
			.filter((key) => queryParams[key] !== undefined)
			.map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(queryParams[key] ?? "")}`)
			.join("&");
		const exposedUrl = await envUtils.exposeUrl(vmServiceUri, this.logger);
		const urlPathSeperator = url.endsWith("/") ? "" : "/";
		return `${url}${urlPathSeperator}${path}?uri=${encodeURIComponent(exposedUrl)}&${paramsString}`;
	}

	private launchInEmbeddedWebView(uri: string, session: DartDebugSessionInformation, page: DevToolsPage, location: "beside" | "active" | undefined) {
		const pageId = page.id;
		if (!this.devToolsEmbeddedViews[pageId]) {
			this.devToolsEmbeddedViews[pageId] = [];
		}
		// Look through any open DevTools frames for this page, to see if any are already our session, or
		// are for a session that has been stopped.
		let frame = this.devToolsEmbeddedViews[pageId]?.find((dtev) => dtev.session === session || dtev.session.hasEnded);
		if (!frame) {
			frame = new DevToolsEmbeddedView(session, uri, page, location);
			frame.onDispose.listen(() => delete this.devToolsEmbeddedViews[pageId]);
			this.devToolsEmbeddedViews[pageId]?.push(frame);
		}
		frame?.load(session, uri);
	}

	private async launchThroughService(
		session: DartDebugSessionInformation & { vmServiceUri: string },
		params: {
			notify?: boolean;
			page?: string;
			queryParams: { [key: string]: string | undefined };
			reuseWindows?: boolean;
		},
	): Promise<boolean> {
		try {
			await session.session.customRequest(
				"callService",
				{
					method: this.debugCommands.vmServices.getServiceMethodName(VmService.LaunchDevTools),
					params,
				},
			);

			return true;
		} catch (e: any) {
			this.logger.error(`DevTools failed to launch Chrome, will launch default browser locally instead: ${e.message}`);
			vs.window.showWarningMessage(`Dart DevTools was unable to launch Chrome so your default browser was launched instead.`, "Show Full Error").then((res) => {
				if (res) {
					const fileName = `bug-${getRandomInt(0x1000, 0x10000).toString(16)}.txt`;
					const tempPath = path.join(os.tmpdir(), fileName);
					fs.writeFileSync(tempPath, `${e.message ?? e}`);
					workspace.openTextDocument(tempPath).then((document) => {
						window.showTextDocument(document);
					});
				}
			});

			return false;
		}
	}

	/// Starts the devtools server and returns the URL of the running app.
	private startServer(hasReinstalled = false): Promise<string> {
		return new Promise<string>((resolve, reject) => {
			if (this.service) {
				try {
					this.service.dispose();
					this.service = undefined;
					this.devtoolsUrl = undefined;
				} catch (e) {
					this.logger.error(e);
				}
			}
			this.service = new DevToolsService(this.logger, this.workspaceContext, this.dartCapabilities);
			const service = this.service;
			this.disposables.push(service);

			service.registerForServerStarted((n) => {
				// When a new debug session starts, we need to wait for its VM
				// Service, then register it with this server.
				this.disposables.push(this.debugCommands.onDebugSessionVmServiceAvailable(async (session) => {
					if (session.vmServiceUri) {
						service.vmRegister({ uri: session.vmServiceUri });
						// Also reconnect any orphaned DevTools views.
						await this.reconnectDisconnectedEmbeddedViews(session as DartDebugSessionInformation & { vmServiceUri: string });
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

			service.process?.on("close", async (code) => {
				this.devtoolsUrl = undefined;
				this.devToolsStatusBarItem.hide();
				if (code && code !== 0) {
					// Reset the port to 0 on error in case it was from us trying to reuse the previous port.
					portToBind = 0;
					const errorMessage = `${devtoolsPackageName} exited with code ${code}.`;
					this.logger.error(errorMessage);

					// If we haven't tried reinstalling, prompt to retry.
					if (!hasReinstalled) {
						const resp = await vs.window.showErrorMessage(`${errorMessage} Would you like to try reactivating DevTools?`, reactivateDevToolsAction, skipAction);
						if (resp === reactivateDevToolsAction) {
							try {
								await this.preActivate(false);
								resolve(await this.startServer(true));
							} catch (e) {
								reject(e);
							}
							return;
						}
					}

					reject(errorMessage);
				}
			});
		});
	}

	public dispose(): any {
		disposeAll(this.disposables);
	}
}

/// Handles running the DevTools process (via pub, or dart).
///
/// This is not used for internal workspaces (see startDevToolsFromDaemon).
class DevToolsService extends StdIOService<UnknownNotification> {
	constructor(logger: Logger, workspaceContext: DartWorkspaceContext, dartCapabilities: DartCapabilities) {
		super(new CategoryLogger(logger, LogCategory.DevTools), config.maxLogLineLength);

		const dartVm = path.join(workspaceContext.sdks.dart, dartVMPath);
		const devToolsArgs = ["--machine", "--try-ports", "10", "--allow-embedding"];
		const customDevTools = config.customDevTools;

		const executionInfo = customDevTools?.script ?
			{
				args: [customDevTools.script],
				cwd: customDevTools.cwd,
				env: customDevTools.env,
				executable: dartVm,

			}
			: dartCapabilities.supportsDartDevTools
				? usingCustomScript(
					dartVm,
					["devtools"],
					workspaceContext.config?.flutterDevToolsScript,
				)
				: getPubExecutionInfo(dartCapabilities, workspaceContext.sdks.dart, ["global", "run", "devtools"]);

		const binPath = executionInfo.executable;
		const binArgs = [...executionInfo.args, ...devToolsArgs];
		const binCwd = executionInfo.cwd;
		const binEnv = executionInfo.env;

		// Store the port we'll use for later so we can re-bind to the same port if we restart.
		portToBind = config.devToolsPort  // Always config first
			|| portToBind;                // Then try the last port we bound this session

		if (portToBind) {
			binArgs.push("--port");
			binArgs.push(portToBind.toString());
		}

		this.registerForServerStarted((n) => this.additionalPidsToTerminate.push(n.pid));

		this.createProcess(binCwd, binPath, binArgs, { toolEnv: getToolEnv(), envOverrides: binEnv });
	}

	protected shouldHandleMessage(message: string): boolean {
		return message.startsWith("{") && message.endsWith("}");
	}

	// TODO: Remove this if we fix the DevTools server (and rev min version) to not use method for
	// the server.started event.
	protected isNotification(msg: any): boolean { return msg.event || msg.method === "server.started"; }

	protected async handleNotification(evt: UnknownNotification): Promise<void> {
		switch ((evt as any).method || evt.event) {
			case "server.started":
				await this.notify(this.serverStartedSubscriptions, evt.params as ServerStartedNotification);
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

interface DevToolsOptions {
	embed?: never;
	location?: "beside" | "active" | "external";
	reuseWindows?: boolean;
	notify?: boolean;
	page?: DevToolsPage | null; // undefined = unspecified (use default), null = force external so user can pick any
	inspectorRef?: string;
}
