import { strict as assert } from "assert";
import * as path from "path";
import * as vs from "vscode";
import { DebuggerType, VmServiceExtension } from "../../shared/enums";
import { versionIsAtLeast } from "../../shared/utils";
import { fsPath } from "../../shared/utils/fs";
import { DartDebugClient } from "../dart_debug_client";
import { createDebugClient, ensureServiceExtensionValue, flutterTestDeviceId, flutterTestDeviceIsWeb, killFlutterTester, startDebugger, waitAllThrowIfTerminates } from "../debug_helpers";
import { activateWithoutAnalysis, closeAllOpenFiles, customScriptExt, defer, deferUntilLast, delay, ensureHasRunWithArgsStarting, flutterHelloWorldFolder, flutterHelloWorldMainFile, flutterHelloWorldNavigateFromFile, flutterHelloWorldNavigateToFile, flutterHelloWorldReadmeFile, flutterHelloWorldStack60File, getLaunchConfiguration, getPackages, makeTrivialChangeToFileDirectly, openFile, positionOf, prepareHasRunFile, privateApi, saveTrivialChangeToFile, sb, setConfigForTest, waitForResult, watchPromise } from "../helpers";

describe(`flutter run debugger (only test device)`, () => {
	beforeEach("Skip test-device tests on web", function () {
		if (flutterTestDeviceIsWeb)
			this.skip();
	});

	before("get packages", () => getPackages());
	beforeEach("activate flutterHelloWorldMainFile", () => activateWithoutAnalysis(flutterHelloWorldMainFile));

	let dc: DartDebugClient;
	let consoleOutputCategory: string;
	beforeEach("create debug client", () => {
		if (privateApi.debugSessions.length > 0) {
			privateApi.logger.warn(`Some debug sessions are already running before test started:`);
			for (const debugSession of privateApi.debugSessions) {
				privateApi.logger.warn(`  Session: ${debugSession.session.name}`);
			}
			privateApi.logger.warn(`Resetting to avoid them affecting future tests`);
			privateApi.debugSessions.length = 0;
		}

		dc = createDebugClient(DebuggerType.Flutter);
		consoleOutputCategory = dc.isDartDap ? "console" : "stdout";
	});

	beforeEach(() => {
		deferUntilLast("Kill flutter_tester", () => watchPromise("Killing flutter_tester processes", killFlutterTester()));
	});

	/// If we restart too fast, things fail :-/
	const delayBeforeRestart = () => delay(1000);

	describe("prompts the user if trying to run with errors", () => {
		it("and cancels launch if they click Show Errors");
		it("and launches if they click Debug Anyway");
		it("unless the errors are in test scripts");
		it("in the test script being run");
	});

	describe("inspector can navigate", () => {
		beforeEach(function () {
			// These tests only work for the new DAP because they rely on the mapping of
			// package URIs into file URIs that we didn't support in the legacy DAPs.
			if (!dc.isDartDap)
				this.skip();
		});

		it("in debug mode", async () => {
			await closeAllOpenFiles();
			await openFile(flutterHelloWorldNavigateFromFile);
			const config = await startDebugger(dc, flutterHelloWorldNavigateFromFile);
			await waitAllThrowIfTerminates(dc,
				dc.flutterAppStarted(),
				dc.configurationSequence(),
				dc.launch(config),
			);

			await waitForResult(
				() => vs.window.activeTextEditor?.document.uri.toString() === flutterHelloWorldNavigateToFile.toString(),
				"Did not navigate to expected file",
				60000,
			);
		});

		it("in noDebug mode", async () => {
			await closeAllOpenFiles();
			await openFile(flutterHelloWorldNavigateFromFile);
			const config = await startDebugger(dc, flutterHelloWorldNavigateFromFile, { noDebug: true });
			await waitAllThrowIfTerminates(dc,
				dc.flutterAppStarted(),
				dc.configurationSequence(),
				dc.launch(config),
			);

			await waitForResult(
				() => vs.window.activeTextEditor?.document.uri.toString() === flutterHelloWorldNavigateToFile.toString(),
				"Did not navigate to expected file",
				60000,
			);
		});
	});

	it("can override platform, toggle brightness/theme", async () => {
		const config = await startDebugger(dc, flutterHelloWorldMainFile);
		await waitAllThrowIfTerminates(dc,
			dc.flutterAppStarted(),
			dc.configurationSequence(),
			dc.launch(config),
		);

		// Can override platform
		// Wait for Platform extension before trying to call it.
		await waitForResult(() => privateApi.debugCommands.vmServices.serviceExtensionIsLoaded(VmServiceExtension.PlatformOverride), "Platform override loaded");

		const showQuickPick = sb.stub(vs.window, "showQuickPick");
		for (const platform of ["iOS", "android", "macOS", "linux"]) {
			showQuickPick.resolves({ platform });
			await vs.commands.executeCommand("flutter.overridePlatform");
			await ensureServiceExtensionValue(VmServiceExtension.PlatformOverride, platform, dc);
		}

		// Can toggle brightness/theme
		// Wait for Brightness extension before trying to call it.
		await waitForResult(() => privateApi.debugCommands.vmServices.serviceExtensionIsLoaded(VmServiceExtension.BrightnessOverride), "Brightness override loaded");

		await ensureServiceExtensionValue(VmServiceExtension.BrightnessOverride, "Brightness.light", dc);
		await vs.commands.executeCommand("flutter.toggleBrightness");
		await ensureServiceExtensionValue(VmServiceExtension.BrightnessOverride, "Brightness.dark", dc);
		await vs.commands.executeCommand("flutter.toggleBrightness");
		await ensureServiceExtensionValue(VmServiceExtension.BrightnessOverride, "Brightness.light", dc);

		await waitAllThrowIfTerminates(dc,
			dc.waitForEvent("terminated"),
			dc.terminateRequest(),
		);
	});

	it("re-sends theme on hot restart only if set by us, not if set by someone else", async () => {
		const config = await startDebugger(dc, flutterHelloWorldMainFile);
		await waitAllThrowIfTerminates(dc,
			dc.flutterAppStarted(),
			dc.configurationSequence(),
			dc.launch(config),
		);

		await waitForResult(() => privateApi.debugCommands.vmServices.serviceExtensionIsLoaded(VmServiceExtension.BrightnessOverride), "Waiting for BrightnessOverride extension", 60000);

		// Re-sends theme on hot restart if set by us.
		{
			// Set the brightness to Dark through our toggle. This leaves us in control so we should
			// we-transmit it.
			await ensureServiceExtensionValue(VmServiceExtension.BrightnessOverride, "Brightness.light", dc);
			await vs.commands.executeCommand("flutter.toggleBrightness");
			await ensureServiceExtensionValue(VmServiceExtension.BrightnessOverride, "Brightness.dark", dc);

			// Hot restart, and wait for the service extension to come back.
			await vs.commands.executeCommand("flutter.hotRestart");
			await waitForResult(() => privateApi.debugCommands.vmServices.serviceExtensionIsLoaded(VmServiceExtension.BrightnessOverride), "Brightness override loaded");
			await delay(100); // Allow time for the values to be re-sent.

			// Ensure the current value is still Dark (ie. we re-sent it).
			await ensureServiceExtensionValue(VmServiceExtension.BrightnessOverride, "Brightness.dark", dc);
		}

		// Does not re-send theme on hot restart if set by someone else.
		{
			// Now check that it's not set if "someone else" updated it.
			await vs.commands.executeCommand("flutter.toggleBrightness");
			await ensureServiceExtensionValue(VmServiceExtension.BrightnessOverride, "Brightness.light", dc);

			// Now set it directly (emulating another tool). This should drop our override so we would not re-send it.
			await privateApi.debugCommands.vmServices.sendExtensionValue(dc.currentSession, VmServiceExtension.BrightnessOverride, "Brightness.dark");
			await ensureServiceExtensionValue(VmServiceExtension.BrightnessOverride, "Brightness.dark", dc);

			// Hot restart, and wait for the service extension to come back.
			await vs.commands.executeCommand("flutter.hotRestart");
			await waitForResult(() => privateApi.debugCommands.vmServices.serviceExtensionIsLoaded(VmServiceExtension.BrightnessOverride), "Brightness override loaded");
			await delay(100); // Allow time for the values to be re-sent.

			// Ensure the current value has reverted (since it was the other tools job to re-send it, but in
			// this case that other tool is fake and did not).
			await ensureServiceExtensionValue(VmServiceExtension.BrightnessOverride, "Brightness.light", dc);
		}

		await waitAllThrowIfTerminates(dc,
			dc.waitForEvent("terminated"),
			dc.terminateRequest(),
		);
	});

	it("resolves relative paths", async () => {
		const config = await getLaunchConfiguration(
			path.relative(fsPath(flutterHelloWorldFolder), fsPath(flutterHelloWorldMainFile)),
			{ deviceId: flutterTestDeviceId },
		);
		assert.equal(config!.program, fsPath(flutterHelloWorldMainFile));
	});

	it("can hot reload with customRequest, using command, on-save, on-save with custom glob, external modification", async () => {
		const config = await startDebugger(dc, flutterHelloWorldMainFile);
		await waitAllThrowIfTerminates(dc,
			dc.flutterAppStarted(),
			watchPromise("hot_reloads_successfully->configurationSequence", dc.configurationSequence()),
			watchPromise("hot_reloads_successfully->launch", dc.launch(config)),
		);
		await delayBeforeRestart();

		// can hot reload with customRequest
		{
			await waitAllThrowIfTerminates(dc,
				dc.waitForHotReload(),
				dc.hotReload(),
			);
		}

		// can hot reload using command
		{
			await waitAllThrowIfTerminates(dc,
				dc.waitForHotReload(),
				Promise.resolve(vs.commands.executeCommand("flutter.hotReload")),
			);
		}

		// hot reloads on save
		{
			await waitAllThrowIfTerminates(dc,
				dc.waitForHotReload(),
				saveTrivialChangeToFile(flutterHelloWorldMainFile),
			);
		}

		// hot reloads on save of custom glob
		{
			await setConfigForTest("dart", "hotReloadPatterns", ["**/*.md"]);
			await waitAllThrowIfTerminates(dc,
				dc.waitForHotReload(),
				saveTrivialChangeToFile(flutterHelloWorldReadmeFile),
			);
		}

		// hot reloads on external modification of file
		{
			await setConfigForTest("dart", "previewHotReloadOnSaveWatcher", true);
			await waitAllThrowIfTerminates(dc,
				dc.waitForHotReload(),
				makeTrivialChangeToFileDirectly(flutterHelloWorldMainFile),
			);
		}

		await waitAllThrowIfTerminates(dc,
			dc.waitForEvent("terminated"),
			dc.terminateRequest(),
		);
	});

	it("can hot restart using customRequest, command", async () => {
		const config = await startDebugger(dc, flutterHelloWorldMainFile);
		await waitAllThrowIfTerminates(dc,
			dc.flutterAppStarted(),
			dc.configurationSequence(),
			dc.launch(config),
		);
		await delayBeforeRestart();

		// can hot restart using customRequest
		{
			await waitAllThrowIfTerminates(dc,
				dc.assertOutputContains("stdout", "Restarted app"),
				dc.customRequest("hotRestart"),
			);
		}

		// can hot restart using command
		{
			await waitAllThrowIfTerminates(dc,
				dc.assertOutputContains("stdout", "Restarted app"),
				vs.commands.executeCommand("flutter.hotRestart") as Promise<void>,
			);
		}

		await waitAllThrowIfTerminates(dc,
			dc.waitForEvent("terminated"),
			dc.terminateRequest(),
		);
	});

	it("automatically spawns DevTools at startup", async () => {
		assert.ok(privateApi.devTools.devtoolsUrl);
		assert.ok((await privateApi.devTools.devtoolsUrl).startsWith("http://"));
	});

	it("can launch DevTools externally", async () => {
		const config = await startDebugger(dc, flutterHelloWorldMainFile);
		await waitAllThrowIfTerminates(dc,
			dc.flutterAppStarted(),
			watchPromise("assertOutputContains", dc.assertOutputContains("console", `Launching lib${path.sep}main.dart on Flutter test device in debug mode...\n`)),
			watchPromise("configurationSequence", dc.configurationSequence()),
			watchPromise("launch", dc.launch(config)),
		);

		await setConfigForTest("dart", "devToolsLocation", "external");
		const openBrowserCommand = sb.stub(privateApi.envUtils, "openInBrowser").resolves();

		const devTools: { url: string, dispose: () => void } = await watchPromise("executeCommand", await vs.commands.executeCommand("dart.openDevTools"));
		assert.ok(openBrowserCommand.calledOnce);
		assert.ok(devTools);
		// Clean up DevTools if it wasn't being eagerly spawned.
		if (!privateApi.workspaceContext.config.startDevToolsServerEagerly)
			defer("Dispose DevTools", devTools.dispose);
		assert.ok(devTools.url);

		const serverResponse = await watchPromise("fetch", privateApi.webClient.fetch(devTools.url));
		assert.notEqual(serverResponse.indexOf("Dart DevTools"), -1);

		await waitAllThrowIfTerminates(dc,
			dc.waitForEvent("terminated"),
			dc.terminateRequest(),
		);
	});

	it("can run using a custom tool", async () => {
		const root = fsPath(flutterHelloWorldFolder);
		const hasRunFile = prepareHasRunFile(root, "flutter");

		const config = await startDebugger(dc, flutterHelloWorldMainFile, {
			customTool: path.join(root, `scripts/custom_flutter.${customScriptExt}`),
			customToolReplacesArgs: 0,
		});
		await waitAllThrowIfTerminates(dc,
			dc.assertOutputContains("console", `Launching lib${path.sep}main.dart on Flutter test device in debug mode...\n`),
			dc.flutterAppStarted(),
			dc.configurationSequence(),
			dc.launch(config),
		);

		await waitAllThrowIfTerminates(dc,
			dc.waitForEvent("terminated"),
			dc.terminateRequest(),
		);

		ensureHasRunWithArgsStarting(root, hasRunFile, "run --machine --start-paused");
	});

	it("can replace all args using custom tool", async () => {
		const root = fsPath(flutterHelloWorldFolder);
		const hasRunFile = prepareHasRunFile(root, "flutter");

		const config = await startDebugger(dc, flutterHelloWorldMainFile, {
			customTool: path.join(root, `scripts/custom_flutter.${customScriptExt}`),
			customToolReplacesArgs: 999999,
			// These differ to the usual ones so we can detect they replaced them.
			toolArgs: ["run", "--ignore-deprecation", "--start-paused", "--machine"],
		});
		await waitAllThrowIfTerminates(dc,
			dc.assertOutputContains("console", `Launching lib${path.sep}main.dart on Flutter test device in debug mode...\n`),
			dc.flutterAppStarted(),
			dc.configurationSequence(),
			dc.launch(config),
		);

		await waitAllThrowIfTerminates(dc,
			dc.waitForEvent("terminated"),
			dc.terminateRequest(),
		);

		ensureHasRunWithArgsStarting(root, hasRunFile, "run --ignore-deprecation --start-paused --machine");
	});

	it("can fetch slices of stack frames", async () => {
		// TODO: This might be unreliable until dev channel gets this.
		const expectFullCount = !versionIsAtLeast(privateApi.dartCapabilities.version, "2.12.0-0");

		await openFile(flutterHelloWorldStack60File);
		const config = await startDebugger(dc, flutterHelloWorldStack60File);
		await dc.hitBreakpoint(config, {
			line: positionOf("^// BREAKPOINT1").line + 1,
			path: fsPath(flutterHelloWorldStack60File),
		});

		// Get the total stack size we should expect and ensure it's a little over the expected current 560
		// (don't hard-code the exact value as it may change with SDK releases).
		const fullStack = await dc.getStack(0, 10000);
		const fullStackFrameCount = fullStack.body.totalFrames ?? 0;
		const expectedMin = 400;
		const expectedMax = 1000;
		assert.ok(
			fullStackFrameCount >= expectedMin && fullStackFrameCount <= expectedMax,
			`Expected ${expectedMin}-${expectedMax} frames but got ${fullStackFrameCount}:
			${fullStack.body.stackFrames.map((f, i) => `   ${i}: ${f.name}`).join("\n")}`,
		);

		const stack1 = await dc.getStack(0, 1); // frame 0
		const stack2 = await dc.getStack(1, 9); // frame 1-10
		const stack3 = await dc.getStack(10, 10); // frame 10-19
		const stack4 = await dc.getStack(20, 1000); // rest
		assert.equal(stack1.body.stackFrames.length, 1);
		// For the first frame, we'll always get 1 + batchSize because we may short-cut going to the VM.
		assert.equal(stack1.body.totalFrames, 21); // Expect n + 20
		assert.equal(stack2.body.stackFrames.length, 9);
		assert.equal(stack2.body.totalFrames, expectFullCount ? fullStackFrameCount : 30); // offset+length+20
		assert.equal(stack3.body.stackFrames.length, 10);
		assert.equal(stack3.body.totalFrames, expectFullCount ? fullStackFrameCount : 40); // offset+length+20
		assert.equal(stack4.body.stackFrames.length, fullStackFrameCount - 20); // Full minus the 20 already fetched.
		assert.equal(stack4.body.totalFrames, fullStackFrameCount); // Always expect full count for rest
		const frameNames = [
			...stack1.body.stackFrames,
			...stack2.body.stackFrames,
			...stack3.body.stackFrames,
			...stack4.body.stackFrames,
		]
			.map((f) => f.name);
		// The top 60 frames should be from func60 down to func1.
		// For Flutter web, each frame appears twice, once as a closure, so handle that for now while
		// waiting to hear if that's expected.
		let frameOffset: number;
		if (frameNames[0] === "func60")
			frameOffset = 0;
		else if (frameNames[1] === "func60")
			frameOffset = 1;
		else
			throw new Error(`Neither of the top two frames are 'frame60': ${frameNames.join(", ")}`);
		const frameMultiplier = frameNames[frameOffset + 2] === "func59" ? 2 : 1;
		for (let i = 0; i < 60; i++) {
			const frameIndex = frameOffset + i * frameMultiplier;
			const expectedFunction = `func${60 - i}`;
			const actualFunction = frameNames[frameIndex];
			assert.equal(actualFunction, expectedFunction, `Frame ${i} at index ${frameIndex} should be ${expectedFunction}`);
		}
	});

	it("logs expected text (and does not stop) at a logpoint", async () => {
		await openFile(flutterHelloWorldMainFile);
		const config = await startDebugger(dc, flutterHelloWorldMainFile);

		let didStop = false;

		dc.waitForStop()
			.then(() => didStop = true)
			.catch(() => {
				// Swallow errors, as we don't care if this times out, we're only using it
				// to tell if we stopped by the time we hit the end of this test.
			});

		await waitAllThrowIfTerminates(dc,
			dc.waitForEvent("initialized")
				.then(() => dc.setBreakpointsRequest({
					breakpoints: [{
						line: positionOf("^// BREAKPOINT1").line,
						// VS Code says to use {} for expressions, but we want to support Dart's native too, so
						// we have examples of both (as well as "escaped" brackets).
						logMessage: '${s} The \\{year} is """{(new DateTime.now()).year}"""',
					}],
					source: { path: fsPath(flutterHelloWorldMainFile) },
				}))
				.then(() => dc.configurationDoneRequest()),
			dc.assertOutputContains(consoleOutputCategory, `Hello! The {year} is """${(new Date()).getFullYear()}"""\n`)
				.then(() => delay(2000))
				.then(() => dc.terminateRequest()),
			dc.waitForEvent("terminated"),
			dc.launch(config),
		);

		assert.equal(didStop, false);
	});

	describe("can evaluate at breakpoint", () => {
		it("simple expressions", async () => {
			await openFile(flutterHelloWorldMainFile);
			const config = await startDebugger(dc, flutterHelloWorldMainFile);
			await waitAllThrowIfTerminates(dc,
				dc.hitBreakpoint(config, {
					line: positionOf("^// BREAKPOINT1").line,
					path: fsPath(flutterHelloWorldMainFile),
				}),
			);

			const evaluateResult = await dc.evaluateForFrame(`"test"`);
			assert.ok(evaluateResult);
			assert.equal(evaluateResult.result, `"test"`);
			assert.equal(evaluateResult.variablesReference, 0);

			await waitAllThrowIfTerminates(dc,
				dc.waitForEvent("terminated"),
				dc.terminateRequest(),
			);
		});

		it("complex expressions", async () => {
			await openFile(flutterHelloWorldMainFile);
			const config = await startDebugger(dc, flutterHelloWorldMainFile);
			await waitAllThrowIfTerminates(dc,
				dc.hitBreakpoint(config, {
					line: positionOf("^// BREAKPOINT1").line,
					path: fsPath(flutterHelloWorldMainFile),
				}),
			);

			const evaluateResult = await dc.evaluateForFrame(`(new DateTime.now()).year`);
			assert.ok(evaluateResult);
			assert.equal(evaluateResult.result, (new Date()).getFullYear().toString());
			assert.equal(evaluateResult.variablesReference, 0);

			await waitAllThrowIfTerminates(dc,
				dc.waitForEvent("terminated"),
				dc.terminateRequest(),
			);
		});

		it("an expression that returns a variable", async () => {
			await openFile(flutterHelloWorldMainFile);
			const config = await startDebugger(dc, flutterHelloWorldMainFile);
			await waitAllThrowIfTerminates(dc,
				dc.hitBreakpoint(config, {
					line: positionOf("^// BREAKPOINT1").line,
					path: fsPath(flutterHelloWorldMainFile),
				}),
			);

			const evaluateResult = await dc.evaluateForFrame(`new DateTime.now()`);
			const thisYear = new Date().getFullYear().toString();
			assert.ok(evaluateResult);
			assert.ok(evaluateResult.result.startsWith("DateTime (" + thisYear), `Result '${evaluateResult.result}' did not start with ${thisYear}`);
			assert.ok(evaluateResult.variablesReference);

			await waitAllThrowIfTerminates(dc,
				dc.waitForEvent("terminated"),
				dc.terminateRequest(),
			);
		});

		it("complex expressions when in a top level function", async () => {
			await openFile(flutterHelloWorldMainFile);
			const config = await startDebugger(dc, flutterHelloWorldMainFile);
			await waitAllThrowIfTerminates(dc,
				dc.hitBreakpoint(config, {
					line: positionOf("^// BREAKPOINT2").line,
					path: fsPath(flutterHelloWorldMainFile),
				}),
			);

			const evaluateResult = await dc.evaluateForFrame(`(new DateTime.now()).year`);
			assert.ok(evaluateResult);
			assert.equal(evaluateResult.result, (new Date()).getFullYear().toString());
			assert.equal(evaluateResult.variablesReference, 0);

			await waitAllThrowIfTerminates(dc,
				dc.waitForEvent("terminated"),
				dc.terminateRequest(),
			);
		});
	});

	describe("can evaluate when not at a breakpoint (global expression evaluation)", function () {
		this.beforeEach(function () {
			if (dc.isDartDap)
				this.skip();
		});

		it("simple expressions", async () => {
			await openFile(flutterHelloWorldMainFile);
			const config = await startDebugger(dc, flutterHelloWorldMainFile);
			await waitAllThrowIfTerminates(dc,
				dc.flutterAppStarted(),
				dc.configurationSequence(),
				dc.launch(config),
			);

			const evaluateResult = await dc.evaluateRequest({ expression: `"test"` });
			assert.ok(evaluateResult);
			assert.ok(evaluateResult.body);
			assert.equal(evaluateResult.body.result, `"test"`);
			assert.equal(evaluateResult.body.variablesReference, 0);

			await waitAllThrowIfTerminates(dc,
				dc.waitForEvent("terminated"),
				dc.terminateRequest(),
			);
		});

		it("complex expressions", async () => {
			await openFile(flutterHelloWorldMainFile);
			const config = await startDebugger(dc, flutterHelloWorldMainFile);
			await waitAllThrowIfTerminates(dc,
				dc.flutterAppStarted(),
				dc.configurationSequence(),
				dc.launch(config),
			);

			const evaluateResult = await dc.evaluateRequest({ expression: `(new DateTime.now()).year` });
			assert.ok(evaluateResult);
			assert.ok(evaluateResult.body);
			assert.equal(evaluateResult.body.result, (new Date()).getFullYear().toString());
			assert.equal(evaluateResult.body.variablesReference, 0);

			await waitAllThrowIfTerminates(dc,
				dc.waitForEvent("terminated"),
				dc.terminateRequest(),
			);
		});

		it("an expression that returns a variable", async () => {
			await openFile(flutterHelloWorldMainFile);
			const config = await startDebugger(dc, flutterHelloWorldMainFile);
			await waitAllThrowIfTerminates(dc,
				dc.flutterAppStarted(),
				dc.configurationSequence(),
				dc.launch(config),
			);

			const evaluateResult = await dc.evaluateRequest({ expression: `new DateTime.now()` });
			const thisYear = new Date().getFullYear().toString();
			assert.ok(evaluateResult);
			assert.ok(evaluateResult.body);
			assert.ok(evaluateResult.body.result.startsWith("DateTime (" + thisYear), `Result '${evaluateResult.body.result}' did not start with ${thisYear}`);
			assert.ok(evaluateResult.body.variablesReference);

			await waitAllThrowIfTerminates(dc,
				dc.waitForEvent("terminated"),
				dc.terminateRequest(),
			);
		});
	});
});
