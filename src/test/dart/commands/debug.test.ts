import { strict as assert } from "assert";
import * as path from "path";
import * as sinon from "sinon";
import * as vs from "vscode";
import { debugLaunchProgressId, debugTerminatingProgressId, doNotAskAgainAction, doNotShowAgainAction, moreInfoAction, widgetInspectorPage } from "../../../shared/constants";
import { DebugOption, DebuggerType, debugOptionNames } from "../../../shared/enums";
import { fsPath } from "../../../shared/utils/fs";
import { startFakeDebugSession } from "../../debug_helpers";
import { activate, currentDoc, defer, getLaunchConfiguration, helloWorldExampleSubFolderMainFile, helloWorldFolder, helloWorldMainFile, helloWorldTestMainFile, myPackageThingFile, privateApi, sb, setConfigForTest, setTestContent, waitForResult } from "../../helpers";

describe("debug commands", () => {
	before("activate", () => activate());

	it("_dart.hotReload.withSave saves dirty files before reloading", async () => {
		const session = startFakeDebugSession({ debuggerType: DebuggerType.Dart, name: "Fake Debug Session (debug command tests)" });
		const saveAll = sb.stub(vs.workspace, "saveAll").resolves(true);

		const doc = currentDoc();
		await setTestContent(doc.getText() + "\n// dirty");

		await vs.commands.executeCommand("_dart.hotReload.withSave");

		assert.ok(saveAll.calledOnce);
		assert.equal(session.hotReloadCount, 1);
	});

	it("dart.rerunLastDebugSession reruns the most recently cached debug configuration", async () => {
		const firstDebugConfig = await getLaunchConfiguration(helloWorldMainFile);
		const lastDebugConfig = await getLaunchConfiguration(helloWorldTestMainFile);
		const startDebugging = sb.stub(vs.debug, "startDebugging").resolves(true);

		assert.ok(firstDebugConfig);
		assert.ok(lastDebugConfig);

		await vs.commands.executeCommand("dart.rerunLastDebugSession");

		assert.ok(startDebugging.calledOnce);
		assert.deepEqual(startDebugging.firstCall.args[0], vs.workspace.workspaceFolders?.[0]);
		assert.deepEqual(startDebugging.firstCall.args[1], lastDebugConfig);
	});

	it("dart.rerunLastTestDebugSession reruns the last cached test configuration", async () => {
		const testDebugConfig = await getLaunchConfiguration(helloWorldTestMainFile);
		const laterNonTestDebugConfig = await getLaunchConfiguration(helloWorldMainFile);
		const startDebugging = sb.stub(vs.debug, "startDebugging").resolves(true);

		assert.ok(testDebugConfig);
		assert.ok(laterNonTestDebugConfig);

		await vs.commands.executeCommand("dart.rerunLastTestDebugSession");

		assert.ok(startDebugging.calledOnce);
		assert.deepEqual(startDebugging.firstCall.args[0], vs.workspace.workspaceFolders?.[0]);
		assert.deepEqual(startDebugging.firstCall.args[1], testDebugConfig);
	});

	it("dart.promptForVmService prompts with the expected UI and normalizes ports", async () => {
		const showInputBox = sb.stub(vs.window, "showInputBox").callsFake(async (options) => {
			assert.equal(options?.ignoreFocusOut, true);
			assert.equal(options?.placeHolder, "Paste a VM Service URI or a port number");
			assert.equal(options?.prompt, "VM Service URI or port number");
			assert.equal(options?.value, "1234");
			assert.equal(options?.validateInput?.("8123"), undefined);
			assert.equal(options?.validateInput?.("ws://127.0.0.1:8123/ws"), undefined);
			assert.equal(options?.validateInput?.("ftp://127.0.0.1:8123"), "Please enter a valid VM Service URI or a port number");

			return "8123";
		});

		const result = await vs.commands.executeCommand<string | undefined>("dart.promptForVmService", "1234");

		assert.equal(result, "http://127.0.0.1:8123");
		assert.ok(showInputBox.calledOnceWithExactly(sinon.match.object));
	});

	it("createLaunchConfiguration adds a workspace-folder launch config for nested projects", async () => {
		const update = sb.stub().resolves();
		const inspect = sb.stub().returns({
			workspaceFolderValue: [{ name: "Existing", request: "launch", type: "dart" }],
			workspaceValue: undefined,
		});
		const openTextDocument = sb.stub(vs.workspace, "openTextDocument").resolves({});
		const showTextDocument = sb.stub(vs.window, "showTextDocument").resolves(undefined);
		sb.stub(vs.workspace, "getConfiguration").withArgs("launch", sinon.match.any).returns({
			inspect,
			update,
		} as any);

		await vs.commands.executeCommand("dart.createLaunchConfiguration", helloWorldExampleSubFolderMainFile);

		assert.ok(update.calledOnce);
		assert.equal(update.firstCall.args[0], "configurations");
		assert.deepEqual(update.firstCall.args[1], [
			{ name: "Existing", request: "launch", type: "dart" },
			{
				cwd: "example",
				name: `Dart (${path.join("bin", "main.dart")})`,
				program: path.join("bin", "main.dart"),
				request: "launch",
				type: "dart",
			},
		]);
		assert.equal(update.firstCall.args[2], vs.ConfigurationTarget.WorkspaceFolder);
		assert.ok(openTextDocument.calledOnceWithExactly(path.join(fsPath(helloWorldFolder), ".vscode", "launch.json")));
		assert.ok(showTextDocument.calledOnce);
	});

	it("getDebugSession returns undefined when there are no active sessions", async () => {
		const showQuickPick = sb.stub(vs.window, "showQuickPick");

		const session = await privateApi.debugCommands.getDebugSession();

		assert.equal(session, undefined);
		assert.equal(showQuickPick.called, false);
	});

	it("getDebugSession returns the only active session without prompting", async () => {
		const fakeSession = startFakeDebugSession({ debuggerType: DebuggerType.Dart, id: "single-session", name: "Single Session" });
		const showQuickPick = sb.stub(vs.window, "showQuickPick");

		const session = await privateApi.debugCommands.getDebugSession();

		assert.equal(session?.session, fakeSession);
		assert.equal(showQuickPick.called, false);
	});

	it("getDebugSession prompts when multiple sessions are active", async () => {
		const firstSession = startFakeDebugSession({ debuggerType: DebuggerType.Dart, id: "session-1", name: "First Session" });
		const secondSession = startFakeDebugSession({ debuggerType: DebuggerType.Flutter, id: "session-2", name: "Second Session" });
		const showQuickPick = sb.stub(vs.window, "showQuickPick").callsFake(async (items, options) => {
			const sessionItems = items as Array<{ session: unknown }> | undefined;
			assert.equal(options?.placeHolder, "Which debug session?");
			assert.equal(sessionItems?.length, 2);
			return sessionItems?.[1];
		});

		const session = await privateApi.debugCommands.getDebugSession();

		assert.equal(session?.session, secondSession);
		assert.ok(showQuickPick.calledOnce);
		assert.notEqual(firstSession.id, secondSession.id);
	});

	it("_dart.toggleDebugOptions rotates through the debug options", async () => {
		const applyNewDebugOption = sb.stub(privateApi.debugCommands, "applyNewDebugOption");

		privateApi.debugCommands.currentDebugOption = DebugOption.MyCode;

		await vs.commands.executeCommand("_dart.toggleDebugOptions");
		assert.equal(privateApi.debugCommands.currentDebugOption, DebugOption.MyCodePackages);

		await vs.commands.executeCommand("_dart.toggleDebugOptions");
		assert.equal(privateApi.debugCommands.currentDebugOption, DebugOption.MyCodePackagesSdk);

		await vs.commands.executeCommand("_dart.toggleDebugOptions");
		assert.equal(privateApi.debugCommands.currentDebugOption, DebugOption.MyCode);

		assert.equal(applyNewDebugOption.callCount, 3);
	});

	it("handleBreakpointChange offers to debug all code for external Dart breakpoints", async () => {
		privateApi.debugCommands.hasPromptedAboutDebugSettings = false;

		const applyNewDebugOption = sb.stub(privateApi.debugCommands, "applyNewDebugOption");
		const showWarningMessage = sb.stub(vs.window, "showWarningMessage").resolves("Debug all code" as any);
		const breakpoint = new vs.SourceBreakpoint(new vs.Location(myPackageThingFile, new vs.Position(0, 0)), true);

		privateApi.debugCommands.currentDebugOption = DebugOption.MyCode;
		privateApi.debugCommands.handleBreakpointChange({
			added: [breakpoint],
			changed: [],
			removed: [],
		});

		await Promise.resolve();

		assert.ok(showWarningMessage.calledOnce);
		assert.equal(privateApi.debugCommands.currentDebugOption, DebugOption.MyCodePackagesSdk);
		assert.ok(applyNewDebugOption.calledOnce);
	});

	it("handleBreakpointChange does not prompt if already prompted", async () => {
		privateApi.debugCommands.hasPromptedAboutDebugSettings = true;

		const applyNewDebugOption = sb.stub(privateApi.debugCommands, "applyNewDebugOption");
		const showWarningMessage = sb.stub(vs.window, "showWarningMessage").resolves("Debug all code" as any);
		const breakpoint = new vs.SourceBreakpoint(new vs.Location(myPackageThingFile, new vs.Position(0, 0)), true);

		privateApi.debugCommands.currentDebugOption = DebugOption.MyCode;
		privateApi.debugCommands.handleBreakpointChange({
			added: [breakpoint],
			changed: [],
			removed: [],
		});

		await Promise.resolve();

		assert.ok(showWarningMessage.notCalled);
		assert.equal(privateApi.debugCommands.currentDebugOption, DebugOption.MyCode);
		assert.ok(applyNewDebugOption.notCalled);
	});

	it("applyNewDebugOption updates status bar, config, and active debug sessions", async () => {
		const session = startFakeDebugSession({ debuggerType: DebuggerType.Dart, id: "opt-session", name: "Opt Session" });
		const customRequest = sb.spy(session, "customRequest");
		const origDebugOption = privateApi.debugCommands.currentDebugOption;
		const origDebugOptionsText = privateApi.debugCommands.debugOptions.text;
		defer("Restore currentDebugOption", () => {
			privateApi.debugCommands.currentDebugOption = origDebugOption;
			privateApi.debugCommands.debugOptions.text = origDebugOptionsText;
		});

		await setConfigForTest("dart", "debugExternalPackageLibraries", false);
		await setConfigForTest("dart", "debugSdkLibraries", false);

		privateApi.debugCommands.currentDebugOption = DebugOption.MyCodePackages;
		privateApi.debugCommands.applyNewDebugOption();
		assert.equal(privateApi.debugCommands.debugOptions.text, `Debug ${debugOptionNames[DebugOption.MyCodePackages]}`);
		assert.ok(customRequest.calledOnceWithExactly("updateDebugOptions", {
			debugExternalPackageLibraries: true,
			debugSdkLibraries: false,
		}));
		await waitForResult(() => vs.workspace.getConfiguration("dart").get("debugExternalPackageLibraries") === true && vs.workspace.getConfiguration("dart").get("debugSdkLibraries") === false);

		customRequest.resetHistory();
		privateApi.debugCommands.currentDebugOption = DebugOption.MyCodeSdk;
		privateApi.debugCommands.applyNewDebugOption();
		assert.equal(privateApi.debugCommands.debugOptions.text, `Debug ${debugOptionNames[DebugOption.MyCodeSdk]}`);
		assert.ok(customRequest.calledOnceWithExactly("updateDebugOptions", {
			debugExternalPackageLibraries: false,
			debugSdkLibraries: true,
		}));
		await waitForResult(() => vs.workspace.getConfiguration("dart").get("debugExternalPackageLibraries") === false && vs.workspace.getConfiguration("dart").get("debugSdkLibraries") === true);

		customRequest.resetHistory();
		privateApi.debugCommands.currentDebugOption = DebugOption.MyCodePackagesSdk;
		privateApi.debugCommands.applyNewDebugOption();
		assert.equal(privateApi.debugCommands.debugOptions.text, `Debug ${debugOptionNames[DebugOption.MyCodePackagesSdk]}`);
		assert.ok(customRequest.calledOnceWithExactly("updateDebugOptions", {
			debugExternalPackageLibraries: true,
			debugSdkLibraries: true,
		}));
		await waitForResult(() => vs.workspace.getConfiguration("dart").get("debugExternalPackageLibraries") === true && vs.workspace.getConfiguration("dart").get("debugSdkLibraries") === true);
	});

	it("setSendLogsToClient sends updateSendLogsToClient only to sessions without sendLogsToClient", async () => {
		const sessionWithoutLogs = startFakeDebugSession({ debuggerType: DebuggerType.Dart, id: "no-logs", name: "No Logs" });
		const sessionWithLogs = startFakeDebugSession({ debuggerType: DebuggerType.Dart, id: "with-logs", name: "With Logs" });
		sessionWithLogs.configuration.sendLogsToClient = true;

		const spyWithout = sb.stub(sessionWithoutLogs, "customRequest").resolves();
		const spyWith = sb.stub(sessionWithLogs, "customRequest").resolves();

		privateApi.debugCommands.setSendLogsToClient(true);
		await waitForResult(() => spyWithout.calledOnce);

		assert.ok(spyWithout.calledOnceWithExactly("updateSendLogsToClient", { enabled: true }));
		assert.ok(spyWith.notCalled);

		// Also verify it swallows errors when older SDKs reject.
		spyWithout.resetHistory();
		spyWithout.rejects(new Error("Unsupported"));
		privateApi.debugCommands.setSendLogsToClient(false);
		await waitForResult(() => spyWithout.calledOnce);
		assert.ok(spyWithout.calledOnceWithExactly("updateSendLogsToClient", { enabled: false }));
	});

	describe("handleCustomEventWithSession", () => {
		it("dart.webLaunchUrl opens URL in browser when not launched and not suppressed, and logs on error", async () => {
			const session = startFakeDebugSession({ debuggerType: DebuggerType.Web, id: "web-session" });
			const openInBrowser = sb.stub(privateApi.envUtils, "openInBrowser").resolves(true);
			const logError = sb.spy(privateApi.logger, "error");

			// Normal launch.
			privateApi.debugCommands.handleDebugSessionCustomEvent({
				body: { launched: false, url: "http://localhost:8080" },
				event: "dart.webLaunchUrl",
				session,
			});
			await waitForResult(() => openInBrowser.calledOnce);
			assert.ok(openInBrowser.calledOnceWithExactly("http://localhost:8080", sinon.match.any));

			// Already launched -> ignored.
			openInBrowser.resetHistory();
			privateApi.debugCommands.handleDebugSessionCustomEvent({
				body: { launched: true, url: "http://localhost:8080" },
				event: "dart.webLaunchUrl",
				session,
			});
			await Promise.resolve();
			assert.ok(openInBrowser.notCalled);

			// Suppressed -> ignored.
			session.configuration.suppressWebServerDeviceBrowserLaunch = true;
			privateApi.debugCommands.handleDebugSessionCustomEvent({
				body: { launched: false, url: "http://localhost:8080" },
				event: "dart.webLaunchUrl",
				session,
			});
			await Promise.resolve();
			assert.ok(openInBrowser.notCalled);
			session.configuration.suppressWebServerDeviceBrowserLaunch = false;

			// Rejects -> logs error.
			openInBrowser.rejects(new Error("Browser failed"));
			privateApi.debugCommands.handleDebugSessionCustomEvent({
				body: { launched: false, url: "http://localhost:8080/fail" },
				event: "dart.webLaunchUrl",
				session,
			});
			await waitForResult(() => logError.calledWith("Failed to launch URL from Flutter app.webLaunchUrl event: http://localhost:8080/fail"));
		});

		it("dart.exposeUrl exposes URL and sends exposeUrlResponse, falling back on error", async () => {
			const session = startFakeDebugSession({ debuggerType: DebuggerType.Dart, id: "expose-session" });
			const exposeUrl = sb.stub(privateApi.envUtils, "exposeUrl").resolves("https://exposed.example.com/");
			const customRequest = sb.spy(session, "customRequest");
			const logError = sb.spy(privateApi.logger, "error");

			privateApi.debugCommands.handleDebugSessionCustomEvent({
				body: { url: "http://localhost:8080/" },
				event: "dart.exposeUrl",
				session,
			});
			await waitForResult(() => customRequest.calledOnce);
			assert.ok(exposeUrl.calledOnceWithExactly("http://localhost:8080/", sinon.match.any));
			assert.ok(customRequest.calledOnceWithExactly("exposeUrlResponse", {
				exposedUrl: "https://exposed.example.com/",
				originalUrl: "http://localhost:8080/",
			}));

			// Fallback on error.
			exposeUrl.resetHistory();
			customRequest.resetHistory();
			exposeUrl.rejects(new Error("Expose error"));
			privateApi.debugCommands.handleDebugSessionCustomEvent({
				body: { url: "http://localhost:8081/" },
				event: "dart.exposeUrl",
				session,
			});
			await waitForResult(() => customRequest.calledOnce);
			assert.ok(logError.calledWithMatch("Failed to expose URL http://localhost:8081/: Error: Expose error"));
			assert.ok(customRequest.calledOnceWithExactly("exposeUrlResponse", {
				exposedUrl: "http://localhost:8081/",
				originalUrl: "http://localhost:8081/",
			}));
		});

		it("flutter.forwardedEvent (app.webLaunchUrl) opens URL when not launched and not suppressed", async () => {
			const session = startFakeDebugSession({ debuggerType: DebuggerType.Flutter, id: "flutter-web-session" });
			const openInBrowser = sb.stub(privateApi.envUtils, "openInBrowser").resolves(true);
			const logError = sb.spy(privateApi.logger, "error");

			privateApi.debugCommands.handleDebugSessionCustomEvent({
				body: {
					event: "app.webLaunchUrl",
					params: { launched: false, url: "http://localhost:9090" },
				},
				event: "flutter.forwardedEvent",
				session,
			});
			await waitForResult(() => openInBrowser.calledOnce);
			assert.ok(openInBrowser.calledOnceWithExactly("http://localhost:9090", sinon.match.any));

			// Rejects -> logs error.
			openInBrowser.rejects(new Error("Browser failed"));
			privateApi.debugCommands.handleDebugSessionCustomEvent({
				body: {
					event: "app.webLaunchUrl",
					params: { launched: false, url: "http://localhost:9090/fail" },
				},
				event: "flutter.forwardedEvent",
				session,
			});
			await waitForResult(() => logError.calledWith("Failed to launch URL from Flutter app.webLaunchUrl event: http://localhost:9090/fail"));
		});

		it("flutter.forwardedEvent (app.warning) handles missing fields, do-not-show, More Info, and Do Not Show Again", async () => {
			const session = startFakeDebugSession({ debuggerType: DebuggerType.Flutter, id: "flutter-warn-session" });
			const logWarn = sb.spy(privateApi.logger, "warn");
			const logError = sb.spy(privateApi.logger, "error");
			const showWarningMessage = sb.stub(vs.window, "showWarningMessage");
			const openInBrowser = sb.stub(privateApi.envUtils, "openInBrowser").resolves(true);
			const warningId = "test-warning-id";

			privateApi.context.setAppWarningDoNotShow(warningId, undefined);
			defer("Reset warning state", () => privateApi.context.setAppWarningDoNotShow(warningId, undefined));

			// Missing warningId or warning text.
			privateApi.debugCommands.handleDebugSessionCustomEvent({
				body: {
					event: "app.warning",
					params: { warningId: "" },
				},
				event: "flutter.forwardedEvent",
				session,
			});
			await waitForResult(() => logWarn.calledWithMatch("Received app.warning event with missing 'warningId' or 'warning' fields"));
			assert.ok(showWarningMessage.notCalled);

			// Prompt with URL and select "More Info".
			showWarningMessage.resolves(moreInfoAction as any);
			privateApi.debugCommands.handleDebugSessionCustomEvent({
				body: {
					event: "app.warning",
					params: { url: "https://flutter.dev/warn", warning: "Something is wrong", warningId },
				},
				event: "flutter.forwardedEvent",
				session,
			});
			await waitForResult(() => openInBrowser.calledOnce);
			assert.ok(showWarningMessage.calledOnceWithExactly("Something is wrong", moreInfoAction, doNotShowAgainAction));
			assert.ok(openInBrowser.calledOnceWithExactly("https://flutter.dev/warn", sinon.match.any));

			// "More Info" when openInBrowser rejects.
			showWarningMessage.resetHistory();
			openInBrowser.rejects(new Error("Browser failed"));
			privateApi.debugCommands.handleDebugSessionCustomEvent({
				body: {
					event: "app.warning",
					params: { url: "https://flutter.dev/warn", warning: "Something is wrong", warningId },
				},
				event: "flutter.forwardedEvent",
				session,
			});
			await waitForResult(() => logError.calledWithMatch("Failed to launch URL from Flutter app.warning event: https://flutter.dev/warn"));

			// Prompt without URL and select "Do Not Show Again".
			showWarningMessage.resetHistory();
			showWarningMessage.resolves(doNotShowAgainAction as any);
			privateApi.debugCommands.handleDebugSessionCustomEvent({
				body: {
					event: "app.warning",
					params: { warning: "No URL warning", warningId },
				},
				event: "flutter.forwardedEvent",
				session,
			});
			await waitForResult(() => privateApi.context.getAppWarningDoNotShow(warningId) === true);
			assert.ok(showWarningMessage.calledOnceWithExactly("No URL warning", doNotShowAgainAction));

			// Subsequent warning with same warningId is skipped.
			showWarningMessage.resetHistory();
			privateApi.debugCommands.handleDebugSessionCustomEvent({
				body: {
					event: "app.warning",
					params: { warning: "Should be skipped", warningId },
				},
				event: "flutter.forwardedEvent",
				session,
			});
			await Promise.resolve();
			assert.ok(showWarningMessage.notCalled);
		});

		it("flutter.forwardedRequest (app.exposeUrl) exposes URL and sends response", async () => {
			const session = startFakeDebugSession({ debuggerType: DebuggerType.Flutter, id: "flutter-expose-session" });
			const exposeUrl = sb.stub(privateApi.envUtils, "exposeUrl").resolves("https://exposed-flutter.example.com/");
			const customRequest = sb.spy(session, "customRequest");
			const logError = sb.spy(privateApi.logger, "error");

			privateApi.debugCommands.handleDebugSessionCustomEvent({
				body: {
					id: "req-1",
					method: "app.exposeUrl",
					params: { url: "http://localhost:8080/" },
				},
				event: "flutter.forwardedRequest",
				session,
			});
			await waitForResult(() => customRequest.calledOnce);
			assert.ok(exposeUrl.calledOnceWithExactly("http://localhost:8080/", sinon.match.any));
			assert.ok(customRequest.calledOnceWithExactly("flutter.sendForwardedRequestResponse", {
				error: undefined,
				id: "req-1",
				result: { url: "https://exposed-flutter.example.com/" },
			}));

			// Fallback to originalUrl on error.
			exposeUrl.resetHistory();
			customRequest.resetHistory();
			exposeUrl.rejects(new Error("Expose failed"));
			privateApi.debugCommands.handleDebugSessionCustomEvent({
				body: {
					id: "req-2",
					method: "app.exposeUrl",
					params: { url: "http://localhost:8082/" },
				},
				event: "flutter.forwardedRequest",
				session,
			});
			await waitForResult(() => customRequest.calledOnce);
			assert.ok(logError.calledWithMatch("Failed to expose URL http://localhost:8082/: Error: Expose failed"));
			assert.ok(customRequest.calledOnceWithExactly("flutter.sendForwardedRequestResponse", {
				error: undefined,
				id: "req-2",
				result: { url: "http://localhost:8082/" },
			}));
		});

		it("dart.progressStart, dart.progressUpdate, and dart.progressEnd manage progress and collapse overlapping reloads/restarts", async () => {
			const session = startFakeDebugSession({ debuggerType: DebuggerType.Flutter, id: "progress-session" });
			const dartSession = privateApi.debugSessions.find((s) => s.session.id === session.id)!;
			const withProgress = sb.spy(vs.window, "withProgress");

			// Start terminating progress, then launch progress (which should complete terminating progress).
			privateApi.debugCommands.handleDebugSessionCustomEvent({
				body: { message: "Terminating...", progressId: debugTerminatingProgressId, title: "Dart" },
				event: "dart.progressStart",
				session,
			});
			const terminatingProgress = dartSession.progress[debugTerminatingProgressId];
			assert.ok(terminatingProgress);
			assert.equal(terminatingProgress.isComplete, false);

			privateApi.debugCommands.handleDebugSessionCustomEvent({
				body: { message: "Launching...", progressId: debugLaunchProgressId, title: "Dart" },
				event: "dart.progressStart",
				session,
			});
			assert.equal(terminatingProgress.isComplete, true);
			assert.equal(dartSession.progress[debugTerminatingProgressId], undefined);
			assert.ok(dartSession.progress[debugLaunchProgressId]);

			// Update and end launch progress (without message for fast completion).
			privateApi.debugCommands.handleDebugSessionCustomEvent({
				body: { message: "Almost done...", progressId: debugLaunchProgressId },
				event: "dart.progressUpdate",
				session,
			});
			privateApi.debugCommands.handleDebugSessionCustomEvent({
				body: { progressId: debugLaunchProgressId },
				event: "dart.progressEnd",
				session,
			});
			assert.equal(dartSession.progress[debugLaunchProgressId], undefined);

			// Overlapping hot-reload progress notifications should collapse.
			withProgress.resetHistory();
			privateApi.debugCommands.handleDebugSessionCustomEvent({
				body: { message: "Reloading 1...", progressId: "hotReload_1", title: "Flutter" },
				event: "dart.progressStart",
				session,
			});
			assert.equal(withProgress.callCount, 1);
			const reloadProgress1 = dartSession.progress.hotReload_1;
			assert.ok(reloadProgress1);

			privateApi.debugCommands.handleDebugSessionCustomEvent({
				body: { message: "Reloading 2...", progressId: "hotReload_2", title: "Flutter" },
				event: "dart.progressStart",
				session,
			});
			// Should not call withProgress again, and should reassign progressId.
			assert.equal(withProgress.callCount, 1);
			assert.equal(dartSession.progress.hotReload_1, undefined);
			assert.equal(dartSession.progress.hotReload_2, reloadProgress1);

			privateApi.debugCommands.handleDebugSessionCustomEvent({
				body: { progressId: "hotReload_2" },
				event: "dart.progressEnd",
				session,
			});
			assert.equal(reloadProgress1.isComplete, true);

			// Overlapping hot-restart progress notifications should collapse.
			withProgress.resetHistory();
			privateApi.debugCommands.handleDebugSessionCustomEvent({
				body: { message: "Restarting 1...", progressId: "hotRestart_1", title: "Flutter" },
				event: "dart.progressStart",
				session,
			});
			assert.equal(withProgress.callCount, 1);
			const restartProgress1 = dartSession.progress.hotRestart_1;
			assert.ok(restartProgress1);

			privateApi.debugCommands.handleDebugSessionCustomEvent({
				body: { message: "Restarting 2...", progressId: "hotRestart_2", title: "Flutter" },
				event: "dart.progressStart",
				session,
			});
			assert.equal(withProgress.callCount, 1);
			assert.equal(dartSession.progress.hotRestart_1, undefined);
			assert.equal(dartSession.progress.hotRestart_2, restartProgress1);

			// End with a final message.
			privateApi.debugCommands.handleDebugSessionCustomEvent({
				body: { message: "Restarted!", progressId: "hotRestart_2" },
				event: "dart.progressEnd",
				session,
			});
			await waitForResult(() => restartProgress1.isComplete);
		});

		it("dart.flutter.widgetErrorInspectData and dart.flutter.devToolsDeepLink handle suppression, Inspect Widget, and Do Not Ask Again", async () => {
			const session = startFakeDebugSession({ debuggerType: DebuggerType.Flutter, id: "widget-error-session" });
			const dartSession = privateApi.debugSessions.find((s) => s.session.id === session.id)!;
			dartSession.vmServiceUri = "ws://127.0.0.1:8123/ws";

			const showWarningMessage = sb.stub(vs.window, "showWarningMessage");
			const spawnDevTools = sb.stub(privateApi.devTools, "spawn").resolves(undefined);
			const logError = sb.spy(privateApi.logger, "error");
			sb.stub(privateApi.devTools, "devtoolsUrl").get(() => Promise.resolve("http://127.0.0.1:9100"));

			await setConfigForTest("dart", "showInspectorNotificationsForWidgetErrors", true);

			// Suppressed when suppressFlutterWidgetErrors is true.
			privateApi.debugCommands.suppressFlutterWidgetErrors = true;
			privateApi.debugCommands.handleDebugSessionCustomEvent({
				body: {
					devToolsUrl: "http://127.0.0.1:9100",
					errorDescription: "Legacy overflow error",
					inspectorReference: "legacy-ref-1",
				},
				event: "dart.flutter.widgetErrorInspectData",
				session,
			});
			privateApi.debugCommands.handleDebugSessionCustomEvent({
				body: {
					deepLinkUrl: "http://example.org/#/inspector?uri&inspectorRef=inspector-0",
					summary: "Overflow error",
				},
				event: "dart.flutter.devToolsDeepLink",
				session,
			});
			await Promise.resolve();
			assert.ok(showWarningMessage.notCalled);
			privateApi.debugCommands.suppressFlutterWidgetErrors = false;

			// Ignored when devToolsUrl does not match.
			privateApi.debugCommands.handleDebugSessionCustomEvent({
				body: {
					devToolsUrl: "http://127.0.0.1:9999",
					errorDescription: "Legacy overflow error",
					inspectorReference: "legacy-ref-1",
				},
				event: "dart.flutter.widgetErrorInspectData",
				session,
			});
			await Promise.resolve();
			assert.ok(showWarningMessage.notCalled);

			// Legacy dart.flutter.widgetErrorInspectData: Inspect Widget.
			showWarningMessage.resolves("Inspect Widget" as any);
			privateApi.debugCommands.handleDebugSessionCustomEvent({
				body: {
					devToolsUrl: "http://127.0.0.1:9100",
					errorDescription: "Legacy overflow error",
					inspectorReference: "legacy-ref-1",
				},
				event: "dart.flutter.widgetErrorInspectData",
				session,
			});
			await waitForResult(() => spawnDevTools.calledOnce && !privateApi.debugCommands.suppressFlutterWidgetErrors);
			assert.ok(showWarningMessage.calledOnceWithExactly("Legacy overflow error", "Inspect Widget", doNotAskAgainAction));
			assert.ok(spawnDevTools.calledOnceWithExactly(
				dartSession as any,
				{ inspectorRef: "legacy-ref-1", pageId: widgetInspectorPage.id },
				true,
			));

			// Legacy dart.flutter.widgetErrorInspectData: Do Not Ask Again.
			showWarningMessage.resetHistory();
			showWarningMessage.resolves(doNotAskAgainAction as any);
			privateApi.debugCommands.handleDebugSessionCustomEvent({
				body: {
					devToolsUrl: "http://127.0.0.1:9100",
					errorDescription: "Legacy overflow error 2",
					inspectorReference: "legacy-ref-2",
				},
				event: "dart.flutter.widgetErrorInspectData",
				session,
			});
			await waitForResult(() => vs.workspace.getConfiguration("dart").get("showInspectorNotificationsForWidgetErrors") === false && !privateApi.debugCommands.suppressFlutterWidgetErrors);
			assert.ok(showWarningMessage.calledOnce);

			await setConfigForTest("dart", "showInspectorNotificationsForWidgetErrors", true);

			// New dart.flutter.devToolsDeepLink: Inspect Widget with valid deepLinkUrl.
			showWarningMessage.resetHistory();
			spawnDevTools.resetHistory();
			showWarningMessage.resolves("Inspect Widget" as any);
			privateApi.debugCommands.handleDebugSessionCustomEvent({
				body: {
					deepLinkUrl: "http://example.org/#/inspector?uri&inspectorRef=inspector-0",
					summary: "A RenderFlex overflowed",
				},
				event: "dart.flutter.devToolsDeepLink",
				session,
			});
			await waitForResult(() => spawnDevTools.calledOnce && !privateApi.debugCommands.suppressFlutterWidgetErrors);
			assert.ok(showWarningMessage.calledOnceWithExactly("A RenderFlex overflowed", "Inspect Widget", doNotAskAgainAction));
			assert.ok(spawnDevTools.calledOnceWithExactly(
				dartSession as any,
				{ inspectorRef: "inspector-0", pageId: "inspector" },
				true,
			));

			// New dart.flutter.devToolsDeepLink: invalid URL logs error, URL without pageId does not spawn.
			showWarningMessage.resetHistory();
			spawnDevTools.resetHistory();
			privateApi.debugCommands.handleDebugSessionCustomEvent({
				body: {
					deepLinkUrl: "http://example.org/#/",
					summary: "Empty pageId link",
				},
				event: "dart.flutter.devToolsDeepLink",
				session,
			});
			await waitForResult(() => showWarningMessage.calledOnce && !privateApi.debugCommands.suppressFlutterWidgetErrors);
			assert.ok(spawnDevTools.notCalled);

			showWarningMessage.resetHistory();
			spawnDevTools.resetHistory();
			privateApi.debugCommands.handleDebugSessionCustomEvent({
				body: {
					deepLinkUrl: "://invalid-url",
					summary: "Invalid link",
				},
				event: "dart.flutter.devToolsDeepLink",
				session,
			});
			await waitForResult(() => logError.calledWith("Failed to parse DevTools deep link URL: ://invalid-url") && !privateApi.debugCommands.suppressFlutterWidgetErrors);
			assert.ok(spawnDevTools.notCalled);

			// New dart.flutter.devToolsDeepLink: Do Not Ask Again.
			showWarningMessage.resetHistory();
			showWarningMessage.resolves(doNotAskAgainAction as any);
			privateApi.debugCommands.handleDebugSessionCustomEvent({
				body: {
					deepLinkUrl: "http://example.org/#/inspector?uri&inspectorRef=inspector-0",
					summary: "Overflow again",
				},
				event: "dart.flutter.devToolsDeepLink",
				session,
			});
			await waitForResult(() => vs.workspace.getConfiguration("dart").get("showInspectorNotificationsForWidgetErrors") === false && !privateApi.debugCommands.suppressFlutterWidgetErrors);
			assert.ok(showWarningMessage.calledOnce);
		});
	});

	describe("dart.copyVmServiceUri", () => {
		it("shows info message when no sessions or no VM service URIs exist", async () => {
			const showInformationMessage = sb.stub(vs.window, "showInformationMessage").resolves(undefined);

			// No sessions at all.
			await vs.commands.executeCommand("dart.copyVmServiceUri");
			assert.ok(showInformationMessage.calledOnceWithExactly("No Dart/Flutter debug session available"));

			// Session exists, but no vmServiceUri.
			showInformationMessage.resetHistory();
			startFakeDebugSession({ debuggerType: DebuggerType.Dart, id: "no-vm-uri" });
			await vs.commands.executeCommand("dart.copyVmServiceUri");
			assert.ok(showInformationMessage.calledOnceWithExactly("No running Dart/Flutter debug sessions have VM Service connections available"));
		});

		it("copies directly to clipboard when 1 option exists, and prompts when multiple exist", async () => {
			const session = startFakeDebugSession({ debuggerType: DebuggerType.Dart, id: "copy-session-1", name: "Session 1" });
			const dartSession = privateApi.debugSessions.find((s) => s.session.id === session.id)!;
			dartSession.vmServiceUri = "ws://127.0.0.1:8123/ws";

			const exposeUrl = sb.stub(privateApi.envUtils, "exposeUrl").resolves("ws://127.0.0.1:8123/ws");
			const showQuickPick = sb.stub(vs.window, "showQuickPick");

			// Single option (exposed URI is identical to vmServiceUri).
			await vs.commands.executeCommand("dart.copyVmServiceUri");
			assert.ok(showQuickPick.notCalled);
			assert.equal(await vs.env.clipboard.readText(), "ws://127.0.0.1:8123/ws");

			// Multiple options (exposed URI differs from vmServiceUri).
			exposeUrl.resolves("wss://exposed.example.com/ws");
			showQuickPick.callsFake(async (items, options) => {
				const uriItems = items as vs.QuickPickItem[] | undefined;
				assert.equal(options?.placeHolder, "Which debug session / VM Service URI?");
				assert.equal(uriItems?.length, 2);
				assert.equal(uriItems?.[0].detail, "ws://127.0.0.1:8123/ws (Local URI on the remote machine)");
				assert.equal(uriItems?.[1].detail, "wss://exposed.example.com/ws (The URI exposed to the client)");
				return uriItems?.[1];
			});

			await vs.commands.executeCommand("dart.copyVmServiceUri");
			assert.ok(showQuickPick.calledOnce);
			assert.equal(await vs.env.clipboard.readText(), "wss://exposed.example.com/ws");

			// User cancels quick pick.
			await vs.env.clipboard.writeText("unchanged");
			showQuickPick.resolves(undefined);
			await vs.commands.executeCommand("dart.copyVmServiceUri");
			assert.equal(await vs.env.clipboard.readText(), "unchanged");
		});
	});

	describe("dart.openDevTools", () => {
		it("shows informational messages when a session has no vmServiceUri, and handles _ext page fallback", async () => {
			const showInformationMessage = sb.stub(vs.window, "showInformationMessage").resolves(undefined);
			const spawnDevTools = sb.stub(privateApi.devTools, "spawn").resolves({ url: "http://127.0.0.1:9100", dispose: () => undefined });

			// _ext page with no debug session falls back to requiresDebugSession = false, prefersDebugSession = true.
			await vs.commands.executeCommand("dart.openDevTools", { pageId: "my_pkg_ext" });
			assert.ok(spawnDevTools.calledOnce);
			assert.equal(spawnDevTools.firstCall.args[0], undefined);

			// Specified debugSessionId that does not exist returns early.
			spawnDevTools.resetHistory();
			await vs.commands.executeCommand("dart.openDevTools", { debugSessionId: "non-existent", requiresDebugSession: true });
			assert.ok(spawnDevTools.notCalled);

			// Now start a session without vmServiceUri to test the informational messages.
			const session = startFakeDebugSession({ debuggerType: DebuggerType.Flutter, id: "devtools-msg-session" });
			const dartSession = privateApi.debugSessions.find((s) => s.session.id === session.id)!;

			// 1. noDebug = true.
			session.configuration.noDebug = true;
			await vs.commands.executeCommand("dart.openDevTools");
			assert.ok(showInformationMessage.calledOnceWithExactly("You must start your app with debugging in order to use DevTools."));
			session.configuration.noDebug = false;

			// 2. --wasm in args / toolArgs.
			showInformationMessage.resetHistory();
			session.configuration.toolArgs = ["--wasm"];
			await vs.commands.executeCommand("dart.openDevTools");
			assert.ok(showInformationMessage.calledOnceWithExactly("DevTools is not available for an app built with Wasm."));
			session.configuration.toolArgs = undefined;

			// 3. flutterMode + flutterDeviceId.
			showInformationMessage.resetHistory();
			dartSession.flutterMode = "release";
			dartSession.flutterDeviceId = "linux";
			await vs.commands.executeCommand("dart.openDevTools");
			assert.ok(showInformationMessage.calledOnceWithExactly("DevTools is not available for an app running in release mode on device 'linux'."));
			dartSession.flutterMode = undefined;
			dartSession.flutterDeviceId = undefined;

			// 4. hasStarted = true.
			showInformationMessage.resetHistory();
			dartSession.hasStarted = true;
			await vs.commands.executeCommand("dart.openDevTools");
			assert.ok(showInformationMessage.calledOnceWithExactly("DevTools is not available for an app running in this mode."));
			dartSession.hasStarted = false;

			// 5. Not ready yet.
			showInformationMessage.resetHistory();
			await vs.commands.executeCommand("dart.openDevTools");
			assert.ok(showInformationMessage.calledOnceWithExactly("This debug session is not ready yet."));
		});
	});
});
