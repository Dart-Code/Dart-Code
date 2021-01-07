import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vs from "vscode";
import { window, workspace } from "vscode";
import { DevToolsCapabilities } from "../../../shared/capabilities/devtools";
import { CHROME_OS_DEVTOOLS_PORT, devToolsPages, isChromeOS, pubPath, reactivateDevToolsAction, skipAction } from "../../../shared/constants";
import { LogCategory, VmService } from "../../../shared/enums";
import { DartWorkspaceContext, DevToolsPage, Logger, SomeError } from "../../../shared/interfaces";
import { CategoryLogger } from "../../../shared/logging";
import { UnknownNotification } from "../../../shared/services/interfaces";
import { StdIOService } from "../../../shared/services/stdio_service";
import { disposeAll, usingCustomScript } from "../../../shared/utils";
import { arraysEqual } from "../../../shared/utils/array";
import { getRandomInt } from "../../../shared/utils/fs";
import { waitFor } from "../../../shared/utils/promises";
import { envUtils, isRunningLocally } from "../../../shared/vscode/utils";
import { Analytics } from "../../analytics";
import { DebugCommands, debugSessions } from "../../commands/debug";
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
	private readonly devToolsStatusBarItem = vs.window.createStatusBarItem(vs.StatusBarAlignment.Right, 100);
	private devToolsActivationPromise: Promise<void> | undefined;
	private devToolsEmbeddedViews: { [key: string]: DevToolsEmbeddedView[] | undefined } = {};
	public get devToolsActivation() { return this.devToolsActivationPromise; }
	private service?: DevToolsService;
	private capabilities = DevToolsCapabilities.empty;

	/// Resolves to the DevTools URL. This is created immediately when a new process is being spawned so that
	/// concurrent launches can wait on the same promise.
	private devtoolsUrl: Thenable<string> | undefined;

	constructor(private readonly logger: Logger, private readonly workspaceContext: DartWorkspaceContext, private readonly debugCommands: DebugCommands, private readonly analytics: Analytics, private readonly pubGlobal: PubGlobal) {
		this.disposables.push(this.devToolsStatusBarItem);

		if (workspaceContext.config?.activateDevToolsEagerly) {
			this.preActivate(true).then(
				() => { this.logger.info(`Finished background activating DevTools`); },
				(e) => {
					this.logger.error("Failed to background activate DevTools");
					this.logger.error(e);
					vs.window.showErrorMessage(`Failed to activate DevTools: ${e}`);
				});
		}
	}

	private async preActivate(silent: boolean): Promise<void> {
		this.devToolsActivationPromise = this.pubGlobal.backgroundActivate(devtoolsPackageName, devtoolsPackageID, silent, this.workspaceContext.config?.devtoolsActivateScript);
		await this.devToolsActivationPromise;
	}

	private routeIdForPage(page: DevToolsPage | undefined): string | undefined {
		if (!page)
			return undefined;

		if (this.capabilities.usesLegacyPageIds && page.legacyPageId)
			return page.legacyPageId;

		return page.pageId;
	}

	/// Spawns DevTools and returns the full URL to open for that session
	///   eg. http://127.0.0.1:8123/?port=8543
	public async spawnForSession(session: DartDebugSessionInformation & { vmServiceUri: string }, options: DevToolsOptions): Promise<{ url: string; dispose: () => void } | undefined> {
		this.analytics.logDebuggerOpenDevTools();

		// If we're mid-silent-activation, wait until that's finished.
		await this.devToolsActivationPromise;

		if (this.service && !this.service.isValidForCurrentSettings) {
			this.service.dispose();
			this.service = undefined;
			this.devtoolsUrl = undefined;
		}

		if (!this.devtoolsUrl) {
			// Don't try to check for install when we run eagerly.
			if (!this.workspaceContext.config?.activateDevToolsEagerly) {
				const installedVersion = await this.pubGlobal.promptToInstallIfRequired(devtoolsPackageName, devtoolsPackageID, undefined, "0.8.0", this.workspaceContext.config?.devtoolsActivateScript, true);
				if (!installedVersion) {
					return undefined;
				}
				this.capabilities.version = installedVersion;
			}

			this.devtoolsUrl = vs.window.withProgress({
				location: vs.ProgressLocation.Notification,
				title: "Starting Dart DevTools...",
			}, async () => this.startServer());
		}

		// If the launched versin of DevTools doesn't support embedding, remove the flag.
		if (!this.capabilities.supportsEmbedFlag)
			options.embed = false;

		// When we're running embedded and were asked to open without a page, we should prompt for a page (plus give an option
		// to open non-embedded view).
		if (options.embed && !options.page) {
			const choice = await this.promptForDevToolsPage();
			if (!choice) // User cancelled
				return;
			else if (choice === "EXTERNAL")
				options.embed = false;
			else
				options.page = choice.page;
		}

		try {
			const url = await this.devtoolsUrl;
			await vs.window.withProgress({
				location: vs.ProgressLocation.Notification,
				title: "Opening Dart DevTools...",
			}, async () => {

				const canLaunchDevToolsThroughService = isRunningLocally
					&& !options.embed
					&& !process.env.DART_CODE_IS_TEST_RUN
					&& config.devToolsBrowser === "chrome"
					&& await waitFor(() => this.debugCommands.vmServices.serviceIsRegistered(VmService.LaunchDevTools), 500);

				await this.launch(!!canLaunchDevToolsThroughService, session, options);
			});

			this.devToolsStatusBarItem.text = "Dart DevTools";
			this.devToolsStatusBarItem.tooltip = `Dart DevTools is running at ${url}`;
			this.devToolsStatusBarItem.command = "dart.openDevTools";
			this.devToolsStatusBarItem.show();
			return { url, dispose: () => this.dispose() };
		} catch (e) {
			this.devToolsStatusBarItem.hide();
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
			const page = devToolsPages.find((p) => p.pageId === pageId);
			const panels = this.devToolsEmbeddedViews[pageId];
			if (!panels)
				continue;

			// If there are disconnected panels for this page, trigger a launch
			// of the page to reuse it.
			const reusablePanel = panels.find((p) => p.session.hasEnded);
			if (reusablePanel) {
				reusablePanel.session = session;
				await this.launch(false, session, { embed: true, page });
			}
		}
	}

	private async launch(allowLaunchThroughService: boolean, session: DartDebugSessionInformation & { vmServiceUri: string }, options: DevToolsOptions) {
		const url = await this.devtoolsUrl;
		if (!url) {
			this.showError(`DevTools URL not available`);
			return;
		}

		const queryParams: { [key: string]: string | undefined } = {
			hide: "debugger",
			ide: "VSCode",
			theme: config.useDevToolsDarkTheme && !options.embed ? "dark" : undefined,
		};

		// Try to launch via service if allowed.
		if (allowLaunchThroughService && await this.launchThroughService(session, { ...options, queryParams, page: this.routeIdForPage(options.page) }))
			return true;

		// Otherwise, fall back to embedded or launching manually.
		if (options.page)
			queryParams.page = this.routeIdForPage(options.page);
		if (options.embed)
			queryParams.embed = "true";
		const fullUrl = await this.buildDevToolsUrl(queryParams, session, url);
		if (options.embed)
			// TODO: What should really we do it we don't have a page?
			this.launchInEmbeddedWebView(fullUrl, session, options.page ?? devToolsPages[0]);
		else
			await envUtils.openInBrowser(fullUrl.toString(), this.logger);
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
		const pageId = page.pageId;
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
				"service",
				{
					params,
					type: this.debugCommands.vmServices.getServiceMethodName(VmService.LaunchDevTools),
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
			this.service = new DevToolsService(this.logger, this.workspaceContext, this.capabilities);
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

					// If we haven't tried reinstalling and we don't have a custom activate script, prompt
					// to retry.
					if (!hasReinstalled && !this.workspaceContext.config?.devtoolsActivateScript) {
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

		const { binPath, binArgs } = usingCustomScript(
			path.join(workspaceContext.sdks.dart, pubPath),
			this.spawnedArgs,
			workspaceContext.config?.devtoolsRunScript,
		);

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

	public get isValidForCurrentSettings() {
		return this.spawnedArgs && arraysEqual(this.spawnedArgs, this.getDevToolsArgs());
	}

	private getDevToolsArgs() {
		const additionalArgs = this.capabilities.supportsEmbedFlag
			? ["--allow-embedding"]
			: ["--enable-notifications"];
		const args = ["global", "run", "devtools", "--machine", "--try-ports", "10"].concat(additionalArgs);
		return args;
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
	embed: boolean;
	reuseWindows?: boolean;
	notify?: boolean;
	page?: DevToolsPage;
}
