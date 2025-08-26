import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vs from "vscode";
import { window, workspace } from "vscode";
import { DartCapabilities } from "../../../shared/capabilities/dart";
import { DevToolsServerCapabilities } from "../../../shared/capabilities/devtools_server";
import { FlutterCapabilities } from "../../../shared/capabilities/flutter";
import { vsCodeVersion } from "../../../shared/capabilities/vscode";
import { CommandSource, cpuProfilerPage, dartVMPath, devToolsHomePage, devToolsPages, devToolsToolLegacyPath, devToolsToolPath, isDartCodeTestRun, performancePage, skipAction, tryAgainAction, twentySecondsInMs, widgetInspectorPage } from "../../../shared/constants";
import { LogCategory, VmService } from "../../../shared/enums";
import { DartWorkspaceContext, DevToolsPage, Logger } from "../../../shared/interfaces";
import { CategoryLogger } from "../../../shared/logging";
import { UnknownNotification } from "../../../shared/services/interfaces";
import { StdIOService } from "../../../shared/services/stdio_service";
import { DartToolingDaemon } from "../../../shared/services/tooling_daemon";
import { disposeAll, usingCustomScript, versionIsAtLeast } from "../../../shared/utils";
import { getRandomInt } from "../../../shared/utils/fs";
import { waitFor } from "../../../shared/utils/promises";
import { ANALYSIS_FILTERS } from "../../../shared/vscode/constants";
import { DartDebugSessionInformation } from "../../../shared/vscode/interfaces";
import { getLanguageStatusItem } from "../../../shared/vscode/status_bar";
import { envUtils, getAllProjectFolders, isRunningLocally } from "../../../shared/vscode/utils";
import { Context } from "../../../shared/vscode/workspace";
import { Analytics } from "../../analytics";
import { DebugCommands, debugSessions, isInFlutterDebugModeDebugSession, isInFlutterProfileModeDebugSession } from "../../commands/debug";
import { config } from "../../config";
import { PubGlobal } from "../../pub/global";
import { ExtensionRecommentations } from "../../recommendations/recommendations";
import { getExcludedFolders } from "../../utils";
import { getToolEnv } from "../../utils/processes";
import { SidebarDevTools } from "../../views/devtools/sidebar_devtools";
import { DevToolsEmbeddedView, DevToolsEmbeddedViewOrSidebarView } from "./embedded_view";

const devtoolsPackageName = "Dart DevTools";

// This starts off undefined, which means we'll read from config.devToolsPort and fall back to undefined (use default).
// Once we get a port we'll update this variable so that if we restart (eg. a silent extension restart due to
// SDK change or similar) we will try to use the same port, so if the user has browser windows open they're
// still valid.
let portToBind: number | undefined;

// This is static because we want to track embedded views across restarts of DevToolsManager.
const devToolsEmbeddedViews: Record<string, DevToolsEmbeddedViewOrSidebarView[] | undefined> = {};

/// Handles launching DevTools in the browser and managing the underlying service.
export class DevToolsManager implements vs.Disposable {
	private readonly disposables: vs.Disposable[] = [];
	private readonly statusBarItem = getLanguageStatusItem("dart.devTools", ANALYSIS_FILTERS);
	private service?: DevToolsService;
	public debugCommands: DebugCommands | undefined;

	/// Resolves to the DevTools URL. This is created immediately when a new process is being spawned so that
	/// concurrent launches can wait on the same promise.
	public devtoolsUrl: Promise<string> | undefined;

	private isShuttingDown = false;

	constructor(
		private readonly logger: Logger,
		private readonly context: Context,
		private readonly analytics: Analytics,
		private readonly pubGlobal: PubGlobal,
		private readonly toolingDaemon: DartToolingDaemon | undefined,
		private readonly dartCapabilities: DartCapabilities,
		private readonly flutterCapabilities: FlutterCapabilities,
		private readonly extensionRecommentations: ExtensionRecommentations,
	) {
		this.statusBarItem.name = "Dart/Flutter DevTools";
		this.statusBarItem.text = "Dart DevTools";
		this.setNotStartedStatusBar();

		void this.handleEagerActivationAndStartup(context.workspaceContext);

		this.disposables.push(vs.debug.onDidTerminateDebugSession((session) => {
			for (const pageId of Object.keys(devToolsEmbeddedViews)) {
				const panels = devToolsEmbeddedViews[pageId];
				if (!panels)
					continue;

				// If there are disconnected panels for this page, trigger a launch
				// of the page to reuse it.
				const sessionPanels = panels
					.filter((p) => p.session?.session.id === session.id);

				for (const panel of sessionPanels) {
					if (panel instanceof SidebarDevTools) {
						panel.unload();
					} else {
						const shouldClose = (config.closeDevTools !== "never" && panel.openedAutomatically) || config.closeDevTools === "always";
						if (shouldClose)
							panel.dispose();
					}

				}
			}
		}));

		// Pre-populate pages for the sidebar pages so they don't show up as infinite spinners.
		for (const page of devToolsPages) {
			if (this.getDevToolsLocation(page.id) === "sidebar") {
				let views = devToolsEmbeddedViews[page.id];
				if (!views)
					views = devToolsEmbeddedViews[page.id] = [];

				if (!views.length) {
					views.push(new SidebarDevTools(page, this, this.dartCapabilities));
				}
			}
		}
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

	public isPageAvailable(hasSession: boolean, page: DevToolsPage) {
		if (page.requiresFlutter && !this.context.workspaceContext.hasAnyFlutterProjects)
			return false;
		if (page.requiredDartSdkVersion && this.context.workspaceContext.sdks.dartVersion && !versionIsAtLeast(this.context.workspaceContext.sdks.dartVersion, page.requiredDartSdkVersion))
			return false;
		if (!page.isStaticTool && !hasSession)
			return false;

		return true;
	}

	private routeIdForPage(page: DevToolsPage | undefined | null): string | undefined {
		if (!page)
			return undefined;

		if (page.routeId)
			return page.routeId(this.flutterCapabilities.version);

		return page.id;
	}

	public async urlFor(page: string): Promise<string | undefined> {
		const base = await this.devtoolsUrl;
		if (!base) return base;

		const queryString = this.buildQueryString(this.getDefaultQueryParams());
		const separator = base.endsWith("/") ? "" : "/";
		return `${base}${separator}${page}?${queryString}`;
	}

	public async start(silent = false): Promise<string | undefined> {

		if (!this.devtoolsUrl) {
			this.setNotStartedStatusBar();

			// Ignore silent flag if we're using a custom DevTools, because it could
			// take much longer to start and won't be obvious why launching isn't working.
			const isCustomDevTools = !!config.customDevTools?.path;
			const startingTitle = isCustomDevTools ? "Starting Custom Dart DevTools…" : "Starting Dart DevTools…";
			if (silent && !isCustomDevTools) {
				this.devtoolsUrl = this.startServer();
			} else {
				this.devtoolsUrl = Promise.resolve(vs.window.withProgress({
					location: vs.ProgressLocation.Notification,
					title: startingTitle,
				}, async () => this.startServer()));
			}

			// Allow us to override the URL for DevTools as a simple hack for running from a
			// dev version without having to have the SDK set up.
			if (config.customDevToolsUri)
				this.devtoolsUrl = Promise.resolve(config.customDevToolsUri);

			// Trigger a reload of any existing embedded windows.
			this.reloadEmbeddedViews();
		}

		const url = await this.devtoolsUrl;

		this.setStartedStatusBar(url);

		return url;
	}

	public getDevToolsLocation(pageId: string | undefined | null): DevToolsLocation {
		if (pageId === null)
			return "external";
		const locations = config.devToolsLocation;
		return locations[pageId ?? ""] ?? locations.default ?? "beside";
	}

	/// Spawns DevTools and returns the full URL to open for that session
	///   eg. http://127.0.0.1:8123/?port=8543
	public async spawn(session: (DartDebugSessionInformation & { vmServiceUri: string }) | undefined, options: DevToolsOptions, forceShow: boolean): Promise<{ url: string; dispose: () => void } | undefined> {
		this.analytics.logDevToolsOpened(options?.commandSource);

		const url = await this.start();
		if (!url)
			return;

		if (options.location === undefined)
			options.location = this.getDevToolsLocation(options.pageId);
		if (!vsCodeVersion.supportsEmbeddedDevTools)
			options.location = "external";
		if (options.reuseWindows === undefined)
			options.reuseWindows = config.devToolsReuseWindows;

		// When we're running embedded and were asked to open without a page, we should prompt for a page (plus give an option
		// to open non-embedded view).
		if (options.location !== "external" && !options.pageId) {
			const choice = await this.promptForDevToolsPage(!!session);
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
					&& session
					&& debugCommands
					&& options.location === "external"
					&& !isDartCodeTestRun
					&& config.devToolsBrowser === "chrome"
					&& await waitFor(() => debugCommands.vmServices.serviceIsRegistered(VmService.LaunchDevTools), 500);

				await this.launch(!!canLaunchDevToolsThroughService, session, options, forceShow);
			});

			return { url, dispose: () => this.dispose() };
		} catch (e) {
			this.showError(e);
		}
	}

	private async promptForDevToolsPage(hasSession: boolean): Promise<{ page: DevToolsPage } | "EXTERNAL" | undefined> {
		const choices: Array<vs.QuickPickItem & { page?: DevToolsPage; isExternal?: boolean }> = [
			{ label: `Open DevTools in Web Browser`, isExternal: true },
			...devToolsPages
				.filter((page) => this.isPageAvailable(hasSession, page))
				.map((page) => ({
					label: `Open ${page.title} Page`,
					page,
				})),
		];
		const choice = !choices.length
			? undefined
			: choices.length === 1
				? choices[0]
				: await vs.window.showQuickPick(choices, { placeHolder: "Which DevTools page?" });
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

		for (const pageId of Object.keys(devToolsEmbeddedViews)) {
			const panels = devToolsEmbeddedViews[pageId];
			if (!panels)
				continue;

			// If there are disconnected panels for this page (or panels with no session yet), trigger a launch
			// of the page to reuse it.
			const reusablePanel = panels.find((p) => p.session?.hasEnded ?? true);
			if (reusablePanel) {
				reusablePanel.session = session;
				await this.launch(false, session, { location: this.getDevToolsLocation(pageId), pageId }, false);
			}
		}
	}

	/// If the DevTools server is restarted, we'll need to reload any DevTools windows that might have stale
	/// server/DTD connections.
	public reloadEmbeddedViews(): void {
		if (!this.devtoolsUrl)
			return;

		for (const pageId of Object.keys(devToolsEmbeddedViews)) {
			const panels = devToolsEmbeddedViews[pageId];
			if (!panels)
				continue;

			// We'll only reload panels that are either connected, or don't have a session (static tools).
			const connectedPanels = panels.filter((p) => !p.session?.hasEnded);
			for (const panel of connectedPanels) {
				panel.reload();
			}
		}
	}

	private getDefaultPage(): DevToolsPage {
		// use true for hasSession here, because this page is available with or without if it
		// meets the version requirements.
		return this.isPageAvailable(true, devToolsHomePage)
			? devToolsHomePage
			: isInFlutterDebugModeDebugSession
				? widgetInspectorPage
				: isInFlutterProfileModeDebugSession
					? performancePage
					: cpuProfilerPage;
	}

	private async launch(allowLaunchThroughService: boolean, session: DartDebugSessionInformation & { vmServiceUri: string } | undefined, options: DevToolsOptions, forceShow: boolean) {
		const url = await this.devtoolsUrl;
		if (!url) {
			this.showError(`DevTools URL not available`);
			return;
		}

		const queryParams: Record<string, string | undefined> = {
			...this.getDefaultQueryParams(),
			ideFeature: options.commandSource,
			inspectorRef: options.inspectorRef,
			theme: config.useDevToolsDarkTheme && options.location === "external" ? "dark" : undefined,
		};

		const pageId = options.pageId ?? this.getDefaultPage().id;
		const page = devToolsPages.find((p) => p.id === pageId);
		const routeId = page ? this.routeIdForPage(page) : pageId;

		// Try to launch via service if allowed.
		if (allowLaunchThroughService && session && await this.launchThroughService(session, { ...options, queryParams, page: routeId }))
			return true;

		// Otherwise, fall back to embedded or launching manually.
		if (pageId)
			queryParams.page = routeId;
		const vmServiceUri = page?.isStaticTool ? undefined : session?.vmServiceUri;
		// We currently only support embedded for pages we know about statically, although since we seem
		// to only use that for a title, we may be able to relax that.
		if (options.location !== "external") {
			if (this.dartCapabilities.requiresDevToolsEmbedFlag)
				queryParams.embed = "true";
			queryParams.embedMode = "one";
			const fullUrl = await this.buildDevToolsUrl(url, queryParams, vmServiceUri, session?.clientVmServiceUri);
			const exposedUrl = await envUtils.exposeUrl(fullUrl);

			const pageInfo = page ?? { id: pageId, title: pageId.replace(/_ext^/, "") };
			this.launchInEmbeddedWebView(exposedUrl, session, pageInfo, options.location, options.triggeredAutomatically, forceShow);
		} else {
			const fullUrl = await this.buildDevToolsUrl(url, queryParams, vmServiceUri, session?.clientVmServiceUri);
			await envUtils.openInBrowser(fullUrl, this.logger);
		}
	}

	private getCacheBust(): string {
		// Add the version to the querystring to avoid any caching of the index.html page.
		let cacheBust = `dart-${this.dartCapabilities.version}-flutter-${this.flutterCapabilities.version}`;
		// If using a custom version of DevTools, bust regardless of version.
		if (config.customDevTools?.path) { // Don't just check config.customDevTools as it's a VS Code Proxy object
			cacheBust += `-custom-${new Date().getTime()}`;
		}

		return cacheBust;
	}

	private getDefaultQueryParams(): Record<string, string | undefined> {
		return {
			cacheBust: this.getCacheBust(),
			ide: "VSCode",
		};
	}

	private buildQueryString(queryParams: Record<string, string | undefined>): string {
		return Object.keys(queryParams)
			.filter((key) => queryParams[key] !== undefined)
			.map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(queryParams[key] ?? "")}`)
			.join("&");
	}

	private async buildDevToolsUrl(baseUrl: string, queryParams: Record<string, string | undefined>, vmServiceUri?: string, clientVmServiceUri?: string) {
		queryParams = {
			...this.getDefaultQueryParams(),
			...queryParams,
		};

		// Handle new Path URL DevTools.
		const path = queryParams.page ?? "";
		delete queryParams.page;

		if (vmServiceUri) {
			/**
			 * In some environments (for ex. g3), the VM Service/DDS could be running on
			 * the end user machine (eg. Mac) while the extension host is an SSH remote
			 * (eg. Linux).
			 *
			 * `clientVmServiceUri` indicates a URI that is already accessible on the end
			 * user machine without forwarding. `vmServiceUri` indicates a URI that is
			 * accessible to the extension host.
			 *
			 * If a `clientVmServiceUri` exists, use it directly instead of trying to
			 * forward a URI from the extension host.
			 */
			if (clientVmServiceUri) {
				queryParams.uri = clientVmServiceUri;
			} else {
				const exposedUrl = await envUtils.exposeUrl(vmServiceUri, this.logger);
				queryParams.uri = exposedUrl;
			}
		}

		const paramsString = this.buildQueryString(queryParams);
		const urlPathSeperator = baseUrl.endsWith("/") ? "" : "/";
		return `${baseUrl}${urlPathSeperator}${path}?${paramsString}`;
	}

	private launchInEmbeddedWebView(uri: string, session: DartDebugSessionInformation | undefined, page: { id: string, title: string }, location: "beside" | "active" | "sidebar" | undefined, triggeredAutomatically: boolean | undefined, forceShow: boolean) {
		const pageId = page.id;
		const pageTitle = page.title;

		let views = devToolsEmbeddedViews[pageId];
		if (!views) {
			views = devToolsEmbeddedViews[pageId] = [];
		}
		// Look through any open DevTools frames for this page, to see if any are already our session, or
		// are for a session that has been stopped.
		let frame = views.find((dtev) => {
			// Don't use a Sidebar frame if we're not enabled/requested.
			if (dtev instanceof SidebarDevTools && location !== "sidebar")
				return false;

			return !dtev.session || dtev.session === session || dtev.session?.hasEnded;
		});
		if (!frame) {
			if (location === "sidebar")
				location = "beside"; // Unsupported sidebar config or view was somehow not pre-populated in frames.
			frame = new DevToolsEmbeddedView(session, uri, pageTitle, location);
			frame.onDispose(() => {
				if (!frame) return;
				const index = views.indexOf(frame);
				if (index === -1) return;
				views.splice(index, 1);
			});
			devToolsEmbeddedViews[pageId]?.push(frame);
		}
		frame.openedAutomatically = !!triggeredAutomatically;
		frame.load(session, uri, forceShow);
	}

	private async launchThroughService(
		session: DartDebugSessionInformation & { vmServiceUri: string },
		params: {
			notify?: boolean;
			page?: string;
			queryParams: Record<string, string | undefined>;
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
		return new Promise<string>(async (resolve, reject) => {
			if (this.service) {
				try {
					this.service.dispose();
					this.service = undefined;
					this.devtoolsUrl = undefined;
				} catch (e) {
					this.logger.error(e);
				}
			}
			const service = this.service = new DevToolsService(this.logger, this.context.workspaceContext, this.toolingDaemon, this.dartCapabilities);
			this.disposables.push(service);
			await service.connect();

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

				// Finally, trigger a check of extensions
				// For initial testing, extension recommendations are allow-list. This comes from config so it can be overridden
				// by the user to allow testing the whole flow before being shipped in the list.
				//
				// Adding "*" to the list allows all extension identifiers, useful for testing.
				setTimeout(async () => {
					try {
						await this.promptForExtensionRecommendations();
					} catch (e) {
						// This can fail if we're restarting/shutting down before it fires.
						const message = `Failed to check for extension recommendations: ${e}`;
						console.error(message);
						this.logger.error(message);
					}
				}, twentySecondsInMs);

				portToBind = n.port;
				resolve(`http://${n.host}:${n.port}/`);
			});

			service.process?.on("close", async (code) => {
				this.devtoolsUrl = undefined;
				this.setNotStartedStatusBar();
				if (code && code !== 0 && !this.isShuttingDown) {
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


	public async promptForExtensionRecommendations(): Promise<void> {
		if (!config.showExtensionRecommendations)
			return;

		if (!this.service)
			return;

		// Need a server that has the new API for getting extensions.
		if (!this.service.capabilities.supportsVsCodeExtensions)
			return;

		// Need an SDK that includes a version of devtools_shared with all desired fixes.
		if (!this.dartCapabilities.supportsDevToolsVsCodeExtensions)
			return;


		const projectFolders = await getAllProjectFolders(this.logger, getExcludedFolders, { requirePubspec: !this.context.workspaceContext.config.forceFlutterWorkspace, searchDepth: config.projectSearchDepth, onlyWorkspaceRoots: this.context.workspaceContext.config.forceFlutterWorkspace });
		const results = await this.service?.discoverExtensions(projectFolders);
		if (!results)
			return;

		const ignoredExtensions = this.context.getIgnoredExtensionRecommendationIdentifiers();
		const installedExtension = vs.extensions.all.map((e) => e.id);
		const promotableExtensions = Object.keys(results).flatMap((projectRoot) => results[projectRoot]?.extensions ?? [])
			// Remove user-ignored extensions.
			.filter((e) => ignoredExtensions.find((ignored) => ignored.trim().toLowerCase() === e.extension.trim().toLowerCase()) === undefined)
			// Remove already-installed extensions.
			.filter((e) => installedExtension.find((installed) => installed.trim().toLowerCase() === e.extension.trim().toLowerCase()) === undefined);
		// If there are multiple we'll just pick the first. The user will either install or ignore
		// and then next time we'd pick the next.
		const promotableExtension = promotableExtensions?.at(0);
		if (promotableExtension) {
			void this.extensionRecommentations.promoteExtension({
				identifier: promotableExtension.extension,
				message: `A third-party extension is available for package:${promotableExtension.packageName}`,
			});
		}
	}

	public dispose(): void {
		this.isShuttingDown = true;
		disposeAll(this.disposables);
	}
}

/// Handles running the DevTools process (via pub, or dart).
///
/// This is not used for internal workspaces (see startDevToolsFromDaemon).
class DevToolsService extends StdIOService<UnknownNotification> {
	public readonly capabilities = DevToolsServerCapabilities.empty;

	constructor(
		logger: Logger,
		private readonly workspaceContext: DartWorkspaceContext,
		private readonly toolingDaemon: DartToolingDaemon | undefined,
		private readonly dartCapabilities: DartCapabilities,
	) {
		super(new CategoryLogger(logger, LogCategory.DevTools), config.maxLogLineLength);
	}

	public async connect(): Promise<void> {
		const workspaceContext = this.workspaceContext;
		const toolingDaemon = this.toolingDaemon;

		const dartVm = path.join(workspaceContext.sdks.dart, dartVMPath);
		const customDevTools = config.customDevTools;

		// Used for both `'dart devtools' and custom devtools
		const devToolsArgs = [
			"--machine",
			"--allow-embedding",
		];

		if (toolingDaemon) {
			const dtdUri = await toolingDaemon.dtdUri;
			if (dtdUri) {
				devToolsArgs.push("--dtd-uri");
				devToolsArgs.push(dtdUri);
				if (this.dartCapabilities.supportsDevToolsDtdExposedUri) {
					const exposedDtdUri = await envUtils.exposeUrl(dtdUri, this.logger);
					if (exposedDtdUri !== dtdUri) {
						devToolsArgs.push("--dtd-exposed-uri");
						devToolsArgs.push(exposedDtdUri);
					}
				}
			}
		}

		const executionInfo = customDevTools?.path ?
			{
				args: ["serve", ...(customDevTools.args ?? [])],
				cwd: customDevTools.path,
				env: customDevTools.env,
				executable: path.join(customDevTools.path, customDevTools.legacy ? devToolsToolLegacyPath : devToolsToolPath),

			}
			: usingCustomScript(
				dartVm,
				["devtools"],
				workspaceContext.config?.flutterDevToolsScript,
			);

		const binPath = executionInfo.executable;
		const binArgs = [...executionInfo.args, ...devToolsArgs];
		const binCwd = executionInfo.cwd;
		const binEnv = executionInfo.env;

		// Store the port we'll use for later so we can re-bind to the same port if we restart.
		portToBind = config.devToolsPort  // Always config first
			|| portToBind;                // Then try the last port we bound this session

		if (portToBind && !customDevTools?.path) {
			binArgs.push("--port");
			binArgs.push(portToBind.toString());
		}

		this.registerForServerStarted((n) => {
			if (n.protocolVersion)
				this.capabilities.version = n.protocolVersion;
			this.additionalPidsToTerminate.push(n.pid);
		});

		this.createProcess(binCwd, binPath, binArgs, { toolEnv: getToolEnv(), envOverrides: binEnv });
	}

	protected shouldHandleMessage(message: string): boolean {
		return message.startsWith("{") && message.endsWith("}");
	}

	// TODO: Remove this if we fix the DevTools server (and rev min version) to not use method for
	// the server.started event.
	protected isNotification(msg: any): boolean { return !!(msg.event || msg.method === "server.started"); }

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

	public async discoverExtensions(projectRoots: string[]): Promise<Record<string, ProjectExtensionResults>> {
		return this.sendRequest("vscode.extensions.discover", {
			rootPaths: projectRoots,
		});
	}
}

export interface ServerStartedNotification {
	host: string;
	port: number;
	pid: number;
	protocolVersion: string | undefined
}

interface DevToolsOptions {
	embed?: never;
	location?: DevToolsLocation;
	reuseWindows?: boolean;
	notify?: boolean;
	pageId?: string | null; // undefined = unspecified (use default), null = force external so user can pick any
	inspectorRef?: string;
	commandSource?: string;
	triggeredAutomatically?: boolean;
}

interface ProjectExtensionResults {
	extensions: ExtensionResult[];
	parseErrors: Array<{ packageName: string, error: any }>;
}

interface ExtensionResult {
	packageName: string;
	extension: string;
}

export type DevToolsLocation = "beside" | "active" | "external" | "sidebar";

export type DevToolsLocations = Record<string, DevToolsLocation | undefined>;

export interface DevToolsLocationsWithDefault extends DevToolsLocations {
	default: DevToolsLocation;
}
