import { strict as assert } from "assert";
import * as vs from "vscode";
import { cpuProfilerPage, performancePage, widgetInspectorPage } from "../../../shared/constants";
import { DartWorkspaceContext, DevToolsPage } from "../../../shared/interfaces";
import { DartDebugSessionInformation } from "../../../shared/vscode/interfaces";
import { startFakeDebugSession } from "../../debug_helpers";
import { activate, defer, privateApi, sb, setConfigForTest } from "../../helpers";

describe("DevTools", () => {
	beforeEach("activate", () => activate());

	function assertDevToolsUriWithVmService(openedUri: string, expectedVmServiceUri: string) {
		const encodedVmServiceUri = encodeURIComponent(expectedVmServiceUri);
		assert.ok(
			openedUri.includes(encodedVmServiceUri),
			`URI did not contain expected VM Service!\nOpened: ${openedUri}\nExpected to contain: ${encodedVmServiceUri}`,
		);
	}

	function startSessionWithVmService(id = "fake-session-1", vmServiceUri = "ws://fake-host:123/ws"): DartDebugSessionInformation & { vmServiceUri: string } {
		const debugSession = startFakeDebugSession({ id });
		privateApi.debugCommands.handleDebugSessionCustomEvent({
			body: { vmServiceUri },
			event: "dart.debuggerUris",
			session: debugSession,
		});
		const dartSession = privateApi.debugSessions.find((s) => s.session.id === debugSession.id);
		assert.ok(dartSession?.vmServiceUri);
		return dartSession as DartDebugSessionInformation & { vmServiceUri: string };
	}

	function cleanupEmbeddedViews() {
		for (const pageId of Object.keys(privateApi.devTools.devToolsEmbeddedViews)) {
			const panels = privateApi.devTools.devToolsEmbeddedViews[pageId];
			if (!panels)
				continue;
			for (const panel of [...panels]) {
				if (panel.unload) {
					// SidebarDevTools stays in devToolsEmbeddedViews; just clear its session.
					panel.session = undefined;
				} else {
					panel.dispose();
				}
			}
		}
	}

	it("opens with the correct VM Service in the URI", async () => {
		const debugSession = startFakeDebugSession();
		const debuggerUrisEvent = {
			vmServiceUri: "ws://fake-host:123/ws",
		};
		privateApi.debugCommands.handleDebugSessionCustomEvent({
			body: debuggerUrisEvent,
			event: "dart.debuggerUris",
			session: debugSession,
		});

		// Stub out openInBrowser so we don't really open and can capture the arguments.
		const openBrowserCommand = sb.stub(privateApi.envUtils, "openInBrowser").resolves();

		// Trigger opening DevTools.
		await vs.commands.executeCommand("dart.openDevTools.external");

		// Verify an attempt was made to open the correct URI.
		assert.equal(openBrowserCommand.calledOnce, true);
		const openedUri = openBrowserCommand.args[0][0] as string; // First invocation, first arg.
		assertDevToolsUriWithVmService(openedUri, debuggerUrisEvent.vmServiceUri);
	});

	it("opens with the correct client VM service in the URI", async () => {
		const debugSession = startFakeDebugSession();
		const debuggerUrisEvent = {
			clientVmServiceUri: "ws://fake-client:456/ws",
			vmServiceUri: "ws://fake-host:123/ws",
		};
		privateApi.debugCommands.handleDebugSessionCustomEvent({
			body: debuggerUrisEvent,
			event: "dart.debuggerUris",
			session: debugSession,
		});

		// Stub out openInBrowser so we don't really open and can capture the arguments.
		const openBrowserCommand = sb.stub(privateApi.envUtils, "openInBrowser").resolves();

		// Trigger opening DevTools.
		await vs.commands.executeCommand("dart.openDevTools.external");

		// Verify an attempt was made to open the correct URI.
		assert.equal(openBrowserCommand.calledOnce, true);
		const openedUri = openBrowserCommand.args[0][0] as string; // First invocation, first arg.
		assertDevToolsUriWithVmService(openedUri, debuggerUrisEvent.clientVmServiceUri);
	});

	describe("page availability, route resolution, and locations", () => {
		it("isPageAvailable checks requiresFlutter, requiredDartSdkVersion, and isStaticTool / hasSession", () => {
			// In hello_world (non-Flutter project), pages requiring Flutter are unavailable.
			assert.equal(privateApi.devTools.isPageAvailable(true, widgetInspectorPage), false);

			// Pages requiring a newer Dart SDK version than current are unavailable.
			const futureSdkPage: DevToolsPage = {
				commandSuffix: "Future",
				id: "future",
				requiredDartSdkVersion: "999.999.999",
				title: "Future Tool",
			};
			assert.equal(privateApi.devTools.isPageAvailable(true, futureSdkPage), false);

			// Non-static tools require an active debug session.
			assert.equal(privateApi.devTools.isPageAvailable(false, cpuProfilerPage), false);
			assert.equal(privateApi.devTools.isPageAvailable(true, cpuProfilerPage), true);

			// Static tools are available even without a debug session if other requirements are met.
			const staticDartPage: DevToolsPage = {
				commandSuffix: "StaticDart",
				id: "static-dart",
				isStaticTool: true,
				requiredDartSdkVersion: "1.0.0",
				title: "Static Dart Tool",
			};
			assert.equal(privateApi.devTools.isPageAvailable(false, staticDartPage), true);
		});

		it("routeIdForPage returns undefined for nullish pages, evaluates custom routeId, or falls back to id", () => {
			assert.equal(privateApi.devTools.routeIdForPage(undefined), undefined);
			assert.equal(privateApi.devTools.routeIdForPage(null), undefined);
			assert.equal(privateApi.devTools.routeIdForPage(cpuProfilerPage), "cpu-profiler");

			const versionStub = sb.stub(privateApi.flutterCapabilities, "version");
			versionStub.get(() => "3.0.0");
			assert.equal(privateApi.devTools.routeIdForPage(performancePage), "performance");

			versionStub.get(() => "2.0.0");
			assert.equal(privateApi.devTools.routeIdForPage(performancePage), "legacy-performance");
		});

		it("urlFor returns undefined when DevTools is not running, and constructs full URL with default query params when running", async () => {
			const originalUrl = privateApi.devTools.devtoolsUrl;
			defer("Restore devtoolsUrl", () => privateApi.devTools.devtoolsUrl = originalUrl);

			privateApi.devTools.devtoolsUrl = undefined;
			assert.equal(await privateApi.devTools.urlFor("inspector"), undefined);

			// Base URL without a trailing slash.
			privateApi.devTools.devtoolsUrl = Promise.resolve("http://127.0.0.1:9100");
			const urlWithoutSlash = await privateApi.devTools.urlFor("inspector");
			assert.ok(urlWithoutSlash);
			assert.ok(urlWithoutSlash.startsWith("http://127.0.0.1:9100/inspector?"));
			assert.ok(urlWithoutSlash.includes("cacheBust="));
			assert.ok(urlWithoutSlash.includes("ide=VSCode"));
			assert.ok(urlWithoutSlash.includes("dashTool="));
			assert.ok(urlWithoutSlash.includes("dashIdeName="));

			// Base URL with a trailing slash and customDevTools configured (adds -custom- to cacheBust).
			await setConfigForTest("dart", "customDevTools", { path: "/tmp/fake-devtools" });
			privateApi.devTools.devtoolsUrl = Promise.resolve("http://127.0.0.1:9100/");
			const urlWithSlash = await privateApi.devTools.urlFor("logging");
			assert.ok(urlWithSlash);
			assert.ok(urlWithSlash.startsWith("http://127.0.0.1:9100/logging?"));
			assert.ok(urlWithSlash.includes("-custom-"));
		});

		it("getDevToolsLocation returns external for null and resolves per-page, default, or beside fallback", async () => {
			assert.equal(privateApi.devTools.getDevToolsLocation(null), "external");
			assert.equal(privateApi.devTools.getDevToolsLocation("inspector"), "sidebar");
			assert.equal(privateApi.devTools.getDevToolsLocation("cpu-profiler"), "beside");

			await setConfigForTest("dart", "devToolsLocation", {
				default: "active",
				logging: "external",
			});
			assert.equal(privateApi.devTools.getDevToolsLocation("logging"), "external");
			assert.equal(privateApi.devTools.getDevToolsLocation("cpu-profiler"), "active");
			assert.equal(privateApi.devTools.getDevToolsLocation(undefined), "active");

			await setConfigForTest("dart", "devToolsLocation", {});
			assert.equal(privateApi.devTools.getDevToolsLocation("cpu-profiler"), "beside");
		});
	});

	describe("handleEagerActivationAndStartup", () => {
		it("starts DevTools silently when startDevToolsServerEagerly is true", async () => {
			const startStub = sb.stub(privateApi.devTools, "start").resolves("http://127.0.0.1:9999/");

			const eagerContext = {
				...privateApi.workspaceContext,
				config: {
					...privateApi.workspaceContext.config,
					startDevToolsServerEagerly: true,
				},
			} as DartWorkspaceContext;

			await privateApi.devTools.handleEagerActivationAndStartup(eagerContext);

			assert.equal(startStub.calledOnceWithExactly(true), true);
		});

		it("logs and shows an error message when eager startup fails", async () => {
			sb.stub(privateApi.devTools, "start").rejects(new Error("Server failed to bind"));
			const showErrorMessage = sb.stub(vs.window, "showErrorMessage").resolves(undefined);
			const loggerError = sb.spy(privateApi.logger, "error");

			const eagerContext = {
				...privateApi.workspaceContext,
				config: {
					...privateApi.workspaceContext.config,
					startDevToolsServerEagerly: true,
				},
			} as DartWorkspaceContext;

			await privateApi.devTools.handleEagerActivationAndStartup(eagerContext);

			assert.equal(loggerError.calledWith("Failed to background start DevTools"), true);
			assert.equal(showErrorMessage.calledOnce, true);
			assert.ok((showErrorMessage.firstCall.args[0] as string).includes("Failed to start DevTools: Error: Server failed to bind"));
		});
	});

	describe("prompting for DevTools page when embedded", () => {
		afterEach("clean up embedded views", () => cleanupEmbeddedViews());

		it("returns undefined without launching when user cancels the page quick pick", async () => {
			const dartSession = startSessionWithVmService();
			const showQuickPick = sb.stub(vs.window, "showQuickPick").resolves(undefined);
			const openInBrowser = sb.stub(privateApi.envUtils, "openInBrowser").resolves(true);
			const createWebviewPanel = sb.spy(vs.window, "createWebviewPanel");

			const res = await privateApi.devTools.spawn(dartSession, { location: "beside" }, true);

			assert.equal(res, undefined);
			assert.equal(showQuickPick.calledOnce, true);
			const items = showQuickPick.firstCall.args[0] as vs.QuickPickItem[];
			assert.equal(items[0].label, "Open DevTools in Web Browser");
			assert.ok(items.some((item) => item.label === "Open Logging Page"));
			assert.equal(openInBrowser.called, false);
			assert.equal(createWebviewPanel.called, false);
		});

		it("opens in external browser when user selects 'Open DevTools in Web Browser'", async () => {
			const dartSession = startSessionWithVmService();
			sb.stub(vs.window, "showQuickPick").callsFake(async (items: readonly vs.QuickPickItem[] | Thenable<readonly vs.QuickPickItem[]>) => {
				const resolvedItems = await items;
				return resolvedItems.find((item) => item.label === "Open DevTools in Web Browser");
			});
			const openInBrowser = sb.stub(privateApi.envUtils, "openInBrowser").resolves(true);

			const res = await privateApi.devTools.spawn(dartSession, { location: "beside" }, true);

			assert.ok(res?.url);
			assert.equal(openInBrowser.calledOnce, true);
			assertDevToolsUriWithVmService(openInBrowser.firstCall.args[0] as string, dartSession.vmServiceUri);
		});

		it("opens embedded view for the selected page when user picks a DevTools page", async () => {
			const dartSession = startSessionWithVmService();
			sb.stub(vs.window, "showQuickPick").callsFake(async (items: readonly vs.QuickPickItem[] | Thenable<readonly vs.QuickPickItem[]>) => {
				const resolvedItems = await items;
				return resolvedItems.find((item) => item.label === "Open Logging Page");
			});
			const createWebviewPanel = sb.spy(vs.window, "createWebviewPanel");

			const res = await privateApi.devTools.spawn(dartSession, { location: "beside" }, true);

			assert.ok(res?.url);
			assert.equal(createWebviewPanel.calledOnce, true);
			assert.equal(createWebviewPanel.firstCall.args[1], "Logging");
		});

		it("automatically selects external browser when no embedded pages are available without a session", async () => {
			const showQuickPick = sb.spy(vs.window, "showQuickPick");
			const openInBrowser = sb.stub(privateApi.envUtils, "openInBrowser").resolves(true);

			const res = await privateApi.devTools.spawn(undefined, { location: "beside" }, true);

			assert.ok(res?.url);
			assert.equal(showQuickPick.called, false);
			assert.equal(openInBrowser.calledOnce, true);
		});

		it("shows an error message if launching DevTools throws", async () => {
			const dartSession = startSessionWithVmService();
			sb.stub(privateApi.envUtils, "openInBrowser").rejects(new Error("Browser launch failed"));
			const showErrorMessage = sb.stub(vs.window, "showErrorMessage").resolves(undefined);

			const res = await privateApi.devTools.spawn(dartSession, { location: "external" }, true);

			assert.equal(res, undefined);
			assert.equal(showErrorMessage.calledOnce, true);
			assert.ok((showErrorMessage.firstCall.args[0] as string).includes("Browser launch failed"));
		});
	});

	describe("session termination, reconnection, and reloading of embedded views", () => {
		afterEach("clean up embedded views", () => cleanupEmbeddedViews());

		it("unloads SidebarDevTools panels when their debug session terminates", async () => {
			const dartSession = startSessionWithVmService("sidebar-session");
			const inspectorPanels = privateApi.devTools.devToolsEmbeddedViews.inspector;
			assert.ok(inspectorPanels?.length);
			const sidebarPanel = inspectorPanels[0];
			const unloadSpy = sb.spy(sidebarPanel, "unload");

			await privateApi.devTools.spawn(dartSession, { pageId: "inspector", location: "sidebar" }, false);
			assert.equal(sidebarPanel.session, dartSession);

			privateApi.devTools.handleDebugSessionEnd(dartSession.session);

			assert.equal(unloadSpy.calledOnce, true);
		});

		it("disposes or retains DevToolsEmbeddedView panels on session termination according to config.closeDevTools", async () => {
			const dartSession = startSessionWithVmService("embedded-session");

			// Open two embedded views: one opened automatically ("logging"), one opened manually ("network").
			await privateApi.devTools.spawn(dartSession, { pageId: "logging", location: "beside", triggeredAutomatically: true }, false);
			await privateApi.devTools.spawn(dartSession, { pageId: "network", location: "active", triggeredAutomatically: false }, false);

			const loggingPanel = privateApi.devTools.devToolsEmbeddedViews.logging?.[0];
			const networkPanel = privateApi.devTools.devToolsEmbeddedViews.network?.[0];
			assert.ok(loggingPanel);
			assert.ok(networkPanel);
			assert.equal(loggingPanel.openedAutomatically, true);
			assert.equal(networkPanel.openedAutomatically, false);

			// 1. When closeDevTools === "never", neither panel is disposed.
			await setConfigForTest("dart", "closeDevTools", "never");
			privateApi.devTools.handleDebugSessionEnd(dartSession.session);
			assert.equal(privateApi.devTools.devToolsEmbeddedViews.logging?.length, 1);
			assert.equal(privateApi.devTools.devToolsEmbeddedViews.network?.length, 1);

			// 2. When closeDevTools === "ifOpened", only the automatically-opened panel ("logging") is disposed.
			await setConfigForTest("dart", "closeDevTools", "ifOpened");
			privateApi.devTools.handleDebugSessionEnd(dartSession.session);
			assert.equal(privateApi.devTools.devToolsEmbeddedViews.logging?.length, 0);
			assert.equal(privateApi.devTools.devToolsEmbeddedViews.network?.length, 1);

			// 3. When closeDevTools === "always", the manually-opened panel ("network") is also disposed.
			await setConfigForTest("dart", "closeDevTools", "always");
			privateApi.devTools.handleDebugSessionEnd(dartSession.session);
			assert.equal(privateApi.devTools.devToolsEmbeddedViews.network?.length, 0);
		});

		it("reloads connected embedded views and reconnects disconnected views when a new session starts", async () => {
			const session1 = startSessionWithVmService("session-1", "ws://fake-host:111/ws");
			await privateApi.devTools.spawn(session1, { pageId: "logging", location: "beside" }, false);
			await privateApi.devTools.spawn(session1, { pageId: "memory", location: "beside" }, false);

			const loggingPanel = privateApi.devTools.devToolsEmbeddedViews.logging?.[0];
			const memoryPanel = privateApi.devTools.devToolsEmbeddedViews.memory?.[0];
			assert.ok(loggingPanel);
			assert.ok(memoryPanel);

			const loggingReloadSpy = sb.spy(loggingPanel, "reload");
			const memoryReloadSpy = sb.spy(memoryPanel, "reload");

			// Mark session1 as ended on memoryPanel while keeping loggingPanel connected to an active session.
			const activeSession = startSessionWithVmService("session-active", "ws://fake-host:222/ws");
			loggingPanel.session = activeSession;
			session1.hasEnded = true;
			privateApi.devTools.devToolsEmbeddedViews.emptyPage = undefined;
			defer("Remove emptyPage", () => delete privateApi.devTools.devToolsEmbeddedViews.emptyPage);

			// reloadEmbeddedViews should only reload connected panels (loggingPanel, not memoryPanel).
			privateApi.devTools.reloadEmbeddedViews();
			assert.equal(loggingReloadSpy.calledOnce, true);
			assert.equal(memoryReloadSpy.called, false);

			// reconnectDisconnectedEmbeddedViews should reconnect memoryPanel (whose session hasEnded is true) to the new session.
			const newSession = startSessionWithVmService("session-2", "ws://fake-host:333/ws");
			await privateApi.devTools.reconnectDisconnectedEmbeddedViews(newSession);
			assert.equal(memoryPanel.session, newSession);

			privateApi.devTools.handleDebugSessionEnd(newSession.session);
		});

		it("returns early from reconnectDisconnectedEmbeddedViews and reloadEmbeddedViews when devtoolsUrl is undefined", async () => {
			const dartSession = startSessionWithVmService();
			const originalUrl = privateApi.devTools.devtoolsUrl;
			defer("Restore devtoolsUrl", () => privateApi.devTools.devtoolsUrl = originalUrl);

			privateApi.devTools.devtoolsUrl = undefined;
			await privateApi.devTools.reconnectDisconnectedEmbeddedViews(dartSession);
			privateApi.devTools.reloadEmbeddedViews();
		});

		it("creates a non-sidebar embedded view when opening a sidebar-configured page with location 'beside' or an unpopulated page with location 'sidebar'", async () => {
			const dartSession = startSessionWithVmService();
			sb.stub(privateApi.dartCapabilities, "requiresDevToolsEmbedFlag").get(() => true);
			const createWebviewPanel = sb.spy(vs.window, "createWebviewPanel");

			// "inspector" has a pre-populated SidebarDevTools in devToolsEmbeddedViews.inspector;
			// requesting location: "beside" should skip the SidebarDevTools and create a DevToolsEmbeddedView.
			await privateApi.devTools.spawn(dartSession, { pageId: "inspector", location: "beside" }, false);
			assert.equal(createWebviewPanel.calledOnce, true);
			assert.equal(createWebviewPanel.firstCall.args[1], "Widget Inspector");

			// Requesting location: "sidebar" for an extension page not pre-populated in devToolsEmbeddedViews
			// should fall back to "beside" and strip "_ext" from the title.
			await privateApi.devTools.spawn(dartSession, { pageId: "my_custom_ext", location: "sidebar" }, false);
			assert.equal(createWebviewPanel.calledTwice, true);
			assert.equal(createWebviewPanel.secondCall.args[1], "my_custom");
		});
	});
});
