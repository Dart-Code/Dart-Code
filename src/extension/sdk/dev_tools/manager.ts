import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vs from "vscode";
import { window, workspace } from "vscode";
import { DartCapabilities } from "../../../shared/capabilities/dart";
import { FlutterCapabilities } from "../../../shared/capabilities/flutter";
import { vsCodeVersion } from "../../../shared/capabilities/vscode";
import { CommandSource, cpuProfilerPage, dartVMPath, devToolsPages, devToolsToolPath, isDartCodeTestRun, performancePage, skipAction, tryAgainAction, widgetInspectorPage } from "../../../shared/constants";
import { LogCategory, VmService } from "../../../shared/enums";
import { DartWorkspaceContext, DevToolsPage, IFlutterDaemon, Logger } from "../../../shared/interfaces";
import { CategoryLogger } from "../../../shared/logging";
import { getPubExecutionInfo } from "../../../shared/processes";
import { UnknownNotification } from "../../../shared/services/interfaces";
import { StdIOService } from "../../../shared/services/stdio_service";
import { disposeAll, usingCustomScript } from "../../../shared/utils";
import { getRandomInt } from "../../../shared/utils/fs";
import { waitFor } from "../../../shared/utils/promises";
import { ANALYSIS_FILTERS } from "../../../shared/vscode/constants";
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
	private readonly statusBarItem = vs.languages.createLanguageStatusItem("dart.devTools", ANALYSIS_FILTERS);
	private devToolsActivationPromise: Promise<void> | undefined;
	private devToolsEmbeddedViews: { [key: string]: DevToolsEmbeddedView[] | undefined } = {};
	public get devToolsActivation() { return this.devToolsActivationPromise; }
	private service?: DevToolsService;
	public debugCommands: DebugCommands | undefined;

	/// Resolves to the DevTools URL. This is created immediately when a new process is being spawned so that
	/// concurrent launches can wait on the same promise.
	public devtoolsUrl: Thenable<string> | undefined;

	constructor(private readonly logger: Logger, private readonly workspaceContext: DartWorkspaceContext, private readonly analytics: Analytics, private readonly pubGlobal: PubGlobal, private readonly dartCapabilities: DartCapabilities, private readonly flutterCapabilities: FlutterCapabilities, private readonly flutterDaemon: IFlutterDaemon | undefined) {
		this.statusBarItem.name = "Dart/Flutter DevTools";
		this.statusBarItem.text = "Dart DevTools";
		this.setNotStartedStatusBar();
		this.disposables.push(this.statusBarItem);

		void this.handleEagerActivationAndStartup(workspaceContext);
	}

	private setNotStartedStatusBar() {
		this.statusBarItem.command = {
			arguments: [{ commandSource: CommandSource.languageStatus }],
			command: "dart.openDevTools",
			title: "start & launch",
			tooltip: "Start and Launch DevTools",
		};
	}

	private setStartedStatusBar(url: string) {
		this.statusBarItem.command = {
			arguments: [{ commandSource: CommandSource.languageStatus }],
			command: "dart.openDevTools",
			title: "launch",
			tooltip: `DevTools is running at ${url}`,
		};
	}

	private async handleEagerActivationAndStartup(workspaceContext: DartWorkspaceContext) {
		if (workspaceContext.config?.startDevToolsServerEagerly) {
			try {
				await this.start(true);
			} catch (e) {
				this.logger.error("Failed to background start DevTools");
				this.logger.error(e);
				void vs.window.showErrorMessage(`Failed to start DevTools: ${e}`);
			}
		}
	}

	private routeIdForPage(page: DevToolsPage | undefined | null): string | undefined {
		if (!page)
			return undefined;

		if (page.routeId)
			return page.routeId(this.flutterCapabilities.version);

		return page.id;
	}

	public async urlFor(page: string): Promise<string | undefined> {
		// TODO(dantup): Theme, etc.
		const base = await this.devtoolsUrl;
		if (!base) return base;

		const separator = base.endsWith("/") ? "" : "/";
		return `${base}${separator}${page}`;
	}

	public async start(silent = false): Promise<string | undefined> {
		// If we're mid-silent-activation, wait until that's finished.
		await this.devToolsActivationPromise;

		if (!this.devtoolsUrl) {
			this.setNotStartedStatusBar();
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
			const isCustomDevTools = !!config.customDevTools?.path;
			const startingTitle = isCustomDevTools ? "Starting Custom Dart DevTools…" : "Starting Dart DevTools…";
			if (silent && !isCustomDevTools) {
				this.devtoolsUrl = this.startServer();
			} else {
				this.devtoolsUrl = vs.window.withProgress({
					location: vs.ProgressLocation.Notification,
					title: startingTitle,
				}, async () => this.startServer());
			}

			// Allow us to override the URL for DevTools as a simple hack for running from a
			// dev version without having to have the SDK set up.
			if (config.customDevToolsUri)
				this.devtoolsUrl = Promise.resolve(config.customDevToolsUri);
		}

		const url = await this.devtoolsUrl;

		this.setStartedStatusBar(url);

		return url;
	}

	/// Spawns DevTools and returns the full URL to open without a debug session.
	public async spawnForNoSession(options?: { commandSource?: string }): Promise<{ url: string; dispose: () => void } | undefined> {
		const commandSource = options?.commandSource;

		let url = await this.start();
		if (!url)
			return;

		this.analytics.logDevToolsOpened(commandSource);
		url = await this.buildDevToolsUrl(url, { commandSource });

		try {
			await envUtils.openInBrowser(url.toString(), this.logger);
		} catch (e) {
			this.showError(e);
		}
	}

	/// Spawns DevTools and returns the full URL to open for that session
	///   eg. http://127.0.0.1:8123/?port=8543
	public async spawnForSession(session: DartDebugSessionInformation & { vmServiceUri: string }, options: DevToolsOptions): Promise<{ url: string; dispose: () => void } | undefined> {
		this.analytics.logDevToolsOpened(options?.commandSource);

		const url = await this.start();
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
		if (options.location !== "external" && !options.pageId) {
			const choice = options.pageId === null ? "EXTERNAL" : await this.promptForDevToolsPage();
			if (!choice) // User cancelled
				return;
			else if (choice === "EXTERNAL")
				options.location = "external";
			else
				options.pageId = choice.page.id;
		}

		try {
			await vs.window.withProgress({
				location: vs.ProgressLocation.Notification,
				title: "Opening DevTools...",
			}, async () => {
				const debugCommands = this.debugCommands;
				const canLaunchDevToolsThroughService = isRunningLocally
					&& debugCommands
					&& options.location === "external"
					&& !isDartCodeTestRun
					&& config.devToolsBrowser === "chrome"
					&& await waitFor(() => debugCommands.vmServices.serviceIsRegistered(VmService.LaunchDevTools), 500);

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
		void vs.window.showErrorMessage(`${e}`);
	}

	/// When a new Debug session starts, we can reconnect any views that are still open
	// in the disconnected state.
	public async reconnectDisconnectedEmbeddedViews(session: DartDebugSessionInformation & { vmServiceUri: string }): Promise<void> {
		if (!this.devtoolsUrl)
			return;

		for (const pageId of Object.keys(this.devToolsEmbeddedViews)) {
			const panels = this.devToolsEmbeddedViews[pageId];
			if (!panels)
				continue;

			// If there are disconnected panels for this page, trigger a launch
			// of the page to reuse it.
			const reusablePanel = panels.find((p) => p.session.hasEnded);
			if (reusablePanel) {
				reusablePanel.session = session;
				await this.launch(false, session, { location: "beside", pageId });
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
			ideFeature: options.commandSource,
			inspectorRef: options.inspectorRef,
			theme: config.useDevToolsDarkTheme && options.location === "external" ? "dark" : "light",
		};

		const pageId = options.pageId ?? this.getDefaultPage().id;
		const page = devToolsPages.find((p) => p.id === pageId);
		const routeId = page ? this.routeIdForPage(page) : pageId;

		// Try to launch via service if allowed.
		if (allowLaunchThroughService && await this.launchThroughService(session, { ...options, queryParams, page: routeId }))
			return true;

		// Otherwise, fall back to embedded or launching manually.
		if (options.pageId)
			queryParams.page = routeId;
		if (options.location !== "external")
			queryParams.embed = "true";
		const fullUrl = await this.buildDevToolsUrl(url, queryParams, session.vmServiceUri);
		// We currently only support embedded for pages we know about statically, although since we seem
		// to only use that for a title, we may be able to relax that.
		if (options.location !== "external" && page) {
			const exposedUrl = await envUtils.exposeUrl(fullUrl);
			this.launchInEmbeddedWebView(exposedUrl, session, page, options.location);
		} else {
			await envUtils.openInBrowser(fullUrl, this.logger);
		}
	}

	private async buildDevToolsUrl(baseUrl: string, queryParams: { [key: string]: string | undefined }, vmServiceUri?: string) {
		queryParams.hide = "debugger";
		queryParams.ide = "VSCode";

		// Add the version to the querystring to avoid any caching of the index.html page.
		let cacheBust = `dart-${this.dartCapabilities.version}-flutter-${this.flutterCapabilities.version}`;
		// If using a custom version of DevTools, bust regardless of version.
		if (!!config.customDevTools?.path) { // Don't just check config.customDevTools as it's a VS Code Proxy object
			cacheBust += `-custom-${new Date().getTime()}`;
		}
		queryParams.cacheBust = cacheBust;

		// Handle new Path URL DevTools.
		let path = "";
		if (this.dartCapabilities.supportsDartDevToolsPathUrls) {
			path = queryParams.page ?? "";
			delete queryParams.page;
		}

		if (vmServiceUri) {
			const exposedUrl = await envUtils.exposeUrl(vmServiceUri, this.logger);
			queryParams.uri = exposedUrl;
		}

		const paramsString = Object.keys(queryParams)
			.filter((key) => queryParams[key] !== undefined)
			.map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(queryParams[key] ?? "")}`)
			.join("&");
		const urlPathSeperator = baseUrl.endsWith("/") ? "" : "/";
		return `${baseUrl}${urlPathSeperator}${path}?${paramsString}`;
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
			frame.onDispose(() => delete this.devToolsEmbeddedViews[pageId]);
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
					method: this.debugCommands!.vmServices.getServiceMethodName(VmService.LaunchDevTools),
					params,
				},
			);

			return true;
		} catch (e: any) {
			this.logger.error(`DevTools failed to launch Chrome, will launch default browser locally instead: ${e.message}`);
			void vs.window.showWarningMessage(`Dart DevTools was unable to launch Chrome so your default browser was launched instead.`, "Show Full Error").then((res) => {
				if (res) {
					const fileName = `bug-${getRandomInt(0x1000, 0x10000).toString(16)}.txt`;
					const tempPath = path.join(os.tmpdir(), fileName);
					fs.writeFileSync(tempPath, `${e.message ?? e}`);
					void workspace.openTextDocument(tempPath).then((document) => {
						void window.showTextDocument(document);
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
				if (this.debugCommands) {
					this.disposables.push(this.debugCommands.onDebugSessionVmServiceAvailable(async (session) => {
						if (session.vmServiceUri) {
							void service.vmRegister({ uri: session.vmServiceUri });
							// Also reconnect any orphaned DevTools views.
							await this.reconnectDisconnectedEmbeddedViews(session as DartDebugSessionInformation & { vmServiceUri: string });
						}
					}));
				}

				// And send any existing sessions we have.
				for (const session of debugSessions) {
					if (session.vmServiceUri)
						void service.vmRegister({ uri: session.vmServiceUri });
				}

				portToBind = n.port;
				resolve(`http://${n.host}:${n.port}/`);
			});

			service.process?.on("close", async (code) => {
				this.devtoolsUrl = undefined;
				this.setNotStartedStatusBar();
				if (code && code !== 0) {
					// Reset the port to 0 on error in case it was from us trying to reuse the previous port.
					portToBind = 0;
					const errorMessage = `${devtoolsPackageName} exited with code ${code}.`;
					this.logger.error(errorMessage);

					// If we haven't tried reinstalling, prompt to retry.
					if (!hasReinstalled) {
						const resp = await vs.window.showErrorMessage(`${errorMessage} Would you like to try again?`, tryAgainAction, skipAction);
						if (resp === tryAgainAction) {
							try {
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
		const devToolsArgs = ["--machine", "--allow-embedding"];
		const customDevTools = config.customDevTools;

		const executionInfo = customDevTools?.path ?
			{
				args: ["serve", "--machine"],
				cwd: customDevTools.path,
				env: customDevTools.env,
				executable: path.join(customDevTools.path, devToolsToolPath),

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
	location?: DevToolsLocation;
	reuseWindows?: boolean;
	notify?: boolean;
	pageId?: string | null; // undefined = unspecified (use default), null = force external so user can pick any
	inspectorRef?: string;
	commandSource?: string;
}

export type DevToolsLocation = "beside" | "active" | "external";
