import * as path from "path";
import * as vs from "vscode";
import { DevToolsCapabilities } from "../../../shared/capabilities/devtools";
import { FlutterCapabilities } from "../../../shared/capabilities/flutter";
import { vsCodeVersion } from "../../../shared/capabilities/vscode";
import { CHROME_OS_DEVTOOLS_PORT, devToolsPages, isChromeOS, pubPath, reactivateDevToolsAction, skipAction } from "../../../shared/constants";
import { LogCategory } from "../../../shared/enums";
import { DartWorkspaceContext, DevToolsPage, IFlutterDaemon, Logger, SomeError } from "../../../shared/interfaces";
import { CategoryLogger } from "../../../shared/logging";
import { UnknownNotification } from "../../../shared/services/interfaces";
import { StdIOService } from "../../../shared/services/stdio_service";
import { disposeAll } from "../../../shared/utils";
import { envUtils } from "../../../shared/vscode/utils";
import { Analytics } from "../../analytics";
import { DebugCommands } from "../../commands/debug";
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
	private capabilities = DevToolsCapabilities.empty;

	/// Resolves to the DevTools URL. This is created immediately when a new process is being spawned so that
	/// concurrent launches can wait on the same promise.
	public devtoolsUrl: Thenable<string> | undefined;

	constructor(private readonly logger: Logger, private readonly workspaceContext: DartWorkspaceContext, private readonly debugCommands: DebugCommands, private readonly analytics: Analytics, private readonly pubGlobal: PubGlobal, private readonly flutterCapabilities: FlutterCapabilities, private readonly flutterDaemon: IFlutterDaemon | undefined) {
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
			const installedVersion = await this.pubGlobal.installIfRequired({
				autoUpdate: true,
				moreInfoLink: undefined,
				packageID: devtoolsPackageID,
				packageName: devtoolsPackageName,
				requiredVersion: "0.9.6",
				silent,
			});
			if (!installedVersion) {
				return undefined;
			}
			this.capabilities.version = installedVersion;
			if (this.workspaceContext.config.startDevToolsFromDaemon) {
				if (!this.flutterDaemon) {
					throw new Error("Flutter daemon is undefined");
				}
				const result = await this.flutterDaemon.serveDevTools();
				this.devtoolsUrl = new Promise<string>((resolve, reject) => {
					if (result.host && result.port) {
						resolve(`http://${result.host}:${result.port}/`);
					} else {
						reject("Unable to serve DevTools");
					}
				});
			} else if (silent) {
				this.devtoolsUrl = this.startServer();
			} else {
				this.devtoolsUrl = vs.window.withProgress({
					location: vs.ProgressLocation.Notification,
					title: "Starting Dart DevTools...",
				}, async () => this.startServer());
			}
		}

		const url = await this.devtoolsUrl;

		this.devToolsStatusBarItem.text = "Dart DevTools";
		if (this.capabilities.version !== DevToolsCapabilities.empty.version) {
			this.devToolsStatusBarItem.tooltip = `DevTools ${this.capabilities.version} is running at ${url}`;
		} else {
			this.devToolsStatusBarItem.tooltip = `DevTools is running at ${url}`;
		}
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

		if (options.embed === undefined)
			options.embed = config.embedDevTools && vsCodeVersion.supportsEmbeddedDevTools;

		// When we're running embedded and were asked to open without a page, we should prompt for a page (plus give an option
		// to open non-embedded view).
		if (options.embed && !options.page) {
			const choice = options.page === null ? "EXTERNAL" : await this.promptForDevToolsPage();
			if (!choice) // User cancelled
				return;
			else if (choice === "EXTERNAL")
				options.embed = false;
			else
				options.page = choice.page;
		}

		try {
			await vs.window.withProgress(
				{
					location: vs.ProgressLocation.Notification,
					title: "Opening DevTools...",
				},
				() => this.launch(session, options),
			);

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

	private showError(e: SomeError) {
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
				await this.launch(session, { embed: true, page });
			}
		}
	}

	private async launch(session: DartDebugSessionInformation & { vmServiceUri: string }, options: DevToolsOptions) {
		const url = await this.devtoolsUrl;
		if (!url) {
			this.showError(`DevTools URL not available`);
			return;
		}

		const queryParams: { [key: string]: string | undefined } = {
			hide: "debugger",
			ide: "VSCode",
			inspectorRef: options.inspectorRef,
			theme: config.useDevToolsDarkTheme && !options.embed ? "dark" : undefined,
		};

		if (options.page)
			queryParams.page = this.routeIdForPage(options.page);
		if (options.embed)
			queryParams.embed = "true";
		const fullUrl = await this.buildDevToolsUrl(queryParams, session, url);
		if (options.embed) {
			const exposedUri = vs.Uri.parse(await envUtils.exposeUrl(fullUrl));
			// TODO: What should we do if we don't have a page?
			this.launchInEmbeddedWebView(exposedUri, session, options.page ?? devToolsPages[0]);
		} else {
			await envUtils.openInBrowser(fullUrl.toString(), this.logger);
		}
	}

	private async buildDevToolsUrl(queryParams: { [key: string]: string | undefined }, session: DartDebugSessionInformation & { vmServiceUri: string }, url: string) {
		const paramsString = Object.keys(queryParams)
			.filter((key) => queryParams[key] !== undefined)
			.map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(queryParams[key] ?? "")}`)
			.join("&");
		const vmServiceUri = vs.Uri.parse(session.vmServiceUri);
		const exposedUrl = await envUtils.exposeUrl(vmServiceUri, this.logger);
		return vs.Uri.parse(`${url}?${paramsString}&uri=${encodeURIComponent(exposedUrl)}`);
	}

	private launchInEmbeddedWebView(uri: vs.Uri, session: DartDebugSessionInformation, page: DevToolsPage) {
		const pageId = page.id;
		if (!this.devToolsEmbeddedViews[pageId]) {
			this.devToolsEmbeddedViews[pageId] = [];
		}
		// Look through any open DevTools frames for this page, to see if any are already our session, or
		// are for a session that has been stopped.
		let frame = this.devToolsEmbeddedViews[pageId]?.find((dtev) => dtev.session === session || dtev.session.hasEnded);
		if (!frame) {
			frame = new DevToolsEmbeddedView(session, uri, page);
			frame.onDispose.listen(() => delete this.devToolsEmbeddedViews[pageId]);
			this.devToolsEmbeddedViews[pageId]?.push(frame);
		}
		frame?.load(session, uri);
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
			this.service = new DevToolsService(this.logger, this.workspaceContext, this.capabilities);
			const service = this.service;
			this.disposables.push(service);

			service.registerForServerStarted((n) => {
				this.disposables.push(this.debugCommands.onDebugSessionVmServiceAvailable(async (session) => {
					// When a new debug session starts, refresh any embedded views for it.
					if (session.vmServiceUri)
						await this.reconnectDisconnectedEmbeddedViews(session as DartDebugSessionInformation & { vmServiceUri: string });
				}));

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

class DevToolsService extends StdIOService<UnknownNotification> {
	private spawnedArgs?: string[];

	constructor(logger: Logger, workspaceContext: DartWorkspaceContext, private readonly capabilities: DevToolsCapabilities) {
		super(new CategoryLogger(logger, LogCategory.DevTools), config.maxLogLineLength);

		this.spawnedArgs = this.getDevToolsArgs();

		// TODO(helin24): Use daemon instead to start DevTools if internal workspace
		const binPath = path.join(workspaceContext.sdks.dart, pubPath);
		const binArgs = this.spawnedArgs;

		// Store the port we'll use for later so we can re-bind to the same port if we restart.
		portToBind = config.devToolsPort // Always config first
			|| portToBind                // Then try the last port we bound this session
			|| (isChromeOS && config.useKnownChromeOSPorts ? CHROME_OS_DEVTOOLS_PORT : undefined);

		if (portToBind) {
			binArgs.push("--port");
			binArgs.push(portToBind.toString());
		}

		this.registerForServerStarted((n) => this.additionalPidsToTerminate.push(n.pid));

		this.createProcess(undefined, binPath, binArgs, { toolEnv: getToolEnv() });
	}

	private getDevToolsArgs() {
		return ["global", "run", "devtools", "--machine", "--try-ports", "10", "--allow-embedding"];
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
}

export interface ServerStartedNotification {
	host: string;
	port: number;
	pid: number;
}

interface DevToolsOptions {
	embed?: boolean;
	page?: DevToolsPage | null; // undefined = unspecified (use default), null = force external so user can pick any
	inspectorRef?: string;
}
