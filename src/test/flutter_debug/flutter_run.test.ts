import { DebugProtocol } from "@vscode/debugprotocol";
import { strict as assert } from "assert";
import * as path from "path";
import * as vs from "vscode";
import { isLinux } from "../../shared/constants";
import { DebuggerType, VmService, VmServiceExtension } from "../../shared/enums";
import { versionIsAtLeast } from "../../shared/utils";
import { faint } from "../../shared/utils/colors";
import { fsPath } from "../../shared/utils/fs";
import { resolvedPromise, waitFor } from "../../shared/utils/promises";
import { DartDebugClient } from "../dart_debug_client";
import { createDebugClient, ensureFrameCategories, ensureMapEntry, ensureNoVariable, ensureServiceExtensionValue, ensureVariable, ensureVariableWithIndex, flutterTestDeviceId, flutterTestDeviceIsWeb, isExternalPackage, isLocalPackage, isSdkFrame, isUserCode, killFlutterTester, startDebugger, waitAllThrowIfTerminates } from "../debug_helpers";
import { activate, closeAllOpenFiles, customScriptExt, defer, deferUntilLast, delay, ensureArrayContainsArray, ensureHasRunWithArgsStarting, extApi, flutterHelloWorldBrokenFile, flutterHelloWorldFolder, flutterHelloWorldGettersFile, flutterHelloWorldHttpFile, flutterHelloWorldLocalPackageFile, flutterHelloWorldMainFile, flutterHelloWorldNavigateFromFile, flutterHelloWorldNavigateToFile, flutterHelloWorldReadmeFile, flutterHelloWorldStack60File, flutterHelloWorldThrowInExternalPackageFile, flutterHelloWorldThrowInLocalPackageFile, flutterHelloWorldThrowInSdkFile, getDefinition, getLaunchConfiguration, getResolvedDebugConfiguration, makeTrivialChangeToFileDirectly, myPackageFolder, openFile, positionOf, prepareHasRunFile, saveTrivialChangeToFile, sb, setConfigForTest, uriFor, waitForResult, watchPromise } from "../helpers";

const deviceName = flutterTestDeviceIsWeb ? "Chrome" : "Flutter test device";

describe(`flutter run debugger (launch on ${flutterTestDeviceId})`, () => {
	beforeEach("activate flutterHelloWorldMainFile", () => activate(flutterHelloWorldMainFile));

	beforeEach("Wait for device to be available", async () => {
		// For web, the device doesn't show up immediately so we need to wait
		// otherwise we will prompt to select a device when starting the debug
		// session in the test. This is not required for flutter-tester as that
		// bypasses the device check.
		if (flutterTestDeviceIsWeb)
			await waitFor(() => extApi.deviceManager!.getDevice(flutterTestDeviceId));
	});

	let dc: DartDebugClient;
	let consoleOutputCategory: string;
	beforeEach("create debug client", function () {
		if (process.env.DART_CODE_FORCE_SDK_DAP === "true" && !extApi.flutterCapabilities.supportsSdkDap)
			this.skip();

		if (extApi.debugSessions.length > 0) {
			extApi.logger.warn(`Some debug sessions are already running before test started:`);
			for (const debugSession of extApi.debugSessions) {
				extApi.logger.warn(`  Session: ${debugSession.session.name}`);
			}
			extApi.logger.warn(`Resetting to avoid them affecting future tests`);
			extApi.debugSessions.length = 0;
		}

		dc = createDebugClient(DebuggerType.Flutter);
		consoleOutputCategory = dc.isDartDap ? "console" : "stdout";
	});

	beforeEach(() => {
		deferUntilLast("Kill flutter_tester", () => watchPromise("Killing flutter_tester processes", killFlutterTester()));
	});

	/// If we restart too fast, things fail :-/
	const delayBeforeRestart = () => delay(1000);

	describe("resolves the correct debug config", () => {
		it("for a simple script", async () => {
			const resolvedConfig = await getResolvedDebugConfiguration({
				args: ["--foo"],
				deviceId: flutterTestDeviceId,
				program: fsPath(flutterHelloWorldMainFile),
			})!;

			assert.ok(resolvedConfig);
			assert.equal(resolvedConfig.program, fsPath(flutterHelloWorldMainFile));
			assert.equal(resolvedConfig.cwd, fsPath(flutterHelloWorldFolder));
			ensureArrayContainsArray(resolvedConfig.toolArgs!, ["-d", flutterTestDeviceId]);
			assert.equal(resolvedConfig.toolArgs!.includes("--web-server-debug-protocol"), false);
			assert.deepStrictEqual(resolvedConfig.args, ["--foo"]);
		});

		it("when using the web-server service", async () => {
			const resolvedConfig = await getResolvedDebugConfiguration({
				deviceId: "web-server",
				program: fsPath(flutterHelloWorldMainFile),
			})!;

			ensureArrayContainsArray(resolvedConfig.toolArgs!, ["--web-server-debug-protocol", "ws"]);
			ensureArrayContainsArray(resolvedConfig.toolArgs!, ["--web-server-debug-injected-client-protocol", "ws"]);
		});

		it("when web renderer is set", async () => {
			await setConfigForTest("dart", "flutterWebRenderer", "html");
			const resolvedConfig = await getResolvedDebugConfiguration({
				deviceId: "web-server",
				program: fsPath(flutterHelloWorldMainFile),
			})!;

			ensureArrayContainsArray(resolvedConfig.toolArgs!, ["--web-renderer", "html"]);
		});

		it("when flutterMode is set", async () => {
			const resolvedConfig = await getResolvedDebugConfiguration({
				deviceId: flutterTestDeviceId,
				flutterMode: "release",
				program: fsPath(flutterHelloWorldMainFile),
			})!;

			ensureArrayContainsArray(resolvedConfig.toolArgs!, ["--release"]);
		});

		it("when flutterPlatform is set", async () => {
			const resolvedConfig = await getResolvedDebugConfiguration({
				deviceId: flutterTestDeviceId,
				flutterPlatform: "android-arm",
				program: fsPath(flutterHelloWorldMainFile),
			})!;

			ensureArrayContainsArray(resolvedConfig.toolArgs!, ["--target-platform", "android-arm"]);
		});

		it("when flutterRunAdditionalArgs is set", async () => {
			await setConfigForTest("dart", "flutterRunAdditionalArgs", ["--no-sound-null-safety"]);
			const resolvedConfig = await getResolvedDebugConfiguration({
				program: fsPath(flutterHelloWorldMainFile),
			})!;

			ensureArrayContainsArray(resolvedConfig.toolArgs!, ["--no-sound-null-safety"]);
		});
	});

	it("runs and remains active until told to quit", async () => {
		const config = await startDebugger(dc, flutterHelloWorldMainFile);
		await waitAllThrowIfTerminates(dc,
			dc.assertOutputContains("console", `Launching lib${path.sep}main.dart on ${deviceName} in debug mode...\n`),
			dc.flutterAppStarted(),
			dc.configurationSequence(),
			dc.launch(config),
		);

		// Ensure we're still responsive after 3 seconds.
		await delay(3000);
		await dc.threadsRequest();

		await waitAllThrowIfTerminates(dc,
			dc.waitForEvent("terminated"),
			dc.terminateRequest(),
		);
	});

	describe("prompts the user if trying to run with errors", () => {
		it("and cancels launch if they click Show Errors");
		it("and launches if they click Debug Anyway");
		it("unless the errors are in test scripts");
		it("in the test script being run");
	});

	it("expected debugger services/extensions are available in debug mode", async () => {
		const config = await startDebugger(dc, flutterHelloWorldMainFile);
		await waitAllThrowIfTerminates(dc,
			dc.flutterAppStarted(),
			dc.configurationSequence(),
			dc.launch(config),
		);

		await waitForResult(() => extApi.debugCommands.vmServices.serviceIsRegistered(VmService.HotRestart) === true, "Hot restart registered");
		await waitForResult(() => extApi.debugCommands.vmServices.serviceIsRegistered(VmService.HotReload) === true, "Hot reload registered");
		await waitForResult(() => extApi.debugCommands.vmServices.serviceExtensionIsLoaded(VmServiceExtension.DebugPaint) === true, "Debug paint loaded");
		await waitForResult(() => extApi.debugCommands.vmServices.serviceExtensionIsLoaded(VmServiceExtension.DebugBanner) === true, "Debug banner loaded");

		await waitAllThrowIfTerminates(dc,
			dc.waitForEvent("terminated"),
			dc.terminateRequest(),
		);

		await waitForResult(() => extApi.debugCommands.vmServices.serviceIsRegistered(VmService.HotRestart) === false, "Hot restart unregistered");
		await waitForResult(() => extApi.debugCommands.vmServices.serviceIsRegistered(VmService.HotReload) === false, "Hot reload unregistered");
		await waitForResult(() => extApi.debugCommands.vmServices.serviceExtensionIsLoaded(VmServiceExtension.DebugPaint) === false, "Debug paint unloaded");
		await waitForResult(() => extApi.debugCommands.vmServices.serviceExtensionIsLoaded(VmServiceExtension.DebugBanner) === false, "Debug banner unloaded");
	});

	it("expected debugger services/extensions are available in noDebug mode", async () => {
		const config = await startDebugger(dc, flutterHelloWorldMainFile);
		config.noDebug = true;
		await waitAllThrowIfTerminates(dc,
			dc.waitForCustomEvent("flutter.appStarted"),
			dc.flutterAppStarted(),
			dc.configurationSequence(),
			dc.launch(config),
		);

		const expectHotReload = true;
		const expectOtherServices = !dc.isDartDap;

		await waitForResult(() => extApi.debugCommands.vmServices.serviceIsRegistered(VmService.HotReload) === expectHotReload, "Hot reload registered");
		await waitForResult(() => extApi.debugCommands.vmServices.serviceIsRegistered(VmService.HotRestart) === expectOtherServices, "Hot restart registered", 30000);
		await waitForResult(() => extApi.debugCommands.vmServices.serviceExtensionIsLoaded(VmServiceExtension.DebugPaint) === expectOtherServices, "Debug paint loaded");
		await waitForResult(() => extApi.debugCommands.vmServices.serviceExtensionIsLoaded(VmServiceExtension.DebugBanner) === expectOtherServices, "Debug banner loaded");

		await waitAllThrowIfTerminates(dc,
			dc.waitForEvent("terminated"),
			dc.terminateRequest(),
		);

		await waitForResult(() => extApi.debugCommands.vmServices.serviceIsRegistered(VmService.HotReload) === false, "Hot reload unregistered");
		await waitForResult(() => extApi.debugCommands.vmServices.serviceIsRegistered(VmService.HotRestart) === false, "Hot restart unregistered");
		await waitForResult(() => extApi.debugCommands.vmServices.serviceExtensionIsLoaded(VmServiceExtension.DebugPaint) === false, "Debug paint unloaded");
		await waitForResult(() => extApi.debugCommands.vmServices.serviceExtensionIsLoaded(VmServiceExtension.DebugBanner) === false, "Debug banner unloaded");
	});

	it("expected debugger services/extensions are available after a hot restart", async () => {
		const config = await startDebugger(dc, flutterHelloWorldMainFile);
		await waitAllThrowIfTerminates(dc,
			dc.flutterAppStarted(),
			dc.configurationSequence(),
			dc.launch(config),
		);

		await waitForResult(() => extApi.debugCommands.vmServices.serviceIsRegistered(VmService.HotRestart) === true, "Hot restart registered");
		await waitForResult(() => extApi.debugCommands.vmServices.serviceIsRegistered(VmService.HotReload) === true, "Hot reload registered");
		await waitForResult(() => extApi.debugCommands.vmServices.serviceExtensionIsLoaded(VmServiceExtension.DebugPaint) === true, "Debug paint loaded");
		await waitForResult(() => extApi.debugCommands.vmServices.serviceExtensionIsLoaded(VmServiceExtension.DebugBanner) === true, "Debug banner loaded");

		await delayBeforeRestart();
		await waitAllThrowIfTerminates(dc,
			dc.assertOutputContains("stdout", "Restarted app"),
			vs.commands.executeCommand("flutter.hotRestart") as Promise<void>,
		);

		await waitForResult(() => extApi.debugCommands.vmServices.serviceIsRegistered(VmService.HotRestart) === true, "Hot restart registered 2");
		await waitForResult(() => extApi.debugCommands.vmServices.serviceIsRegistered(VmService.HotReload) === true, "Hot reload registered 2");
		await waitForResult(() => extApi.debugCommands.vmServices.serviceExtensionIsLoaded(VmServiceExtension.DebugPaint) === true, "Debug paint loaded 2");
		await waitForResult(() => extApi.debugCommands.vmServices.serviceExtensionIsLoaded(VmServiceExtension.DebugBanner) === true, "Debug banner loaded 2");

		await waitAllThrowIfTerminates(dc,
			dc.waitForEvent("terminated"),
			dc.terminateRequest(),
		);

		await waitForResult(() => extApi.debugCommands.vmServices.serviceIsRegistered(VmService.HotRestart) === false, "Hot restart unregistered");
		await waitForResult(() => extApi.debugCommands.vmServices.serviceIsRegistered(VmService.HotReload) === false, "Hot reload unregistered");
		await waitForResult(() => extApi.debugCommands.vmServices.serviceExtensionIsLoaded(VmServiceExtension.DebugPaint) === false, "Debug paint unloaded");
		await waitForResult(() => extApi.debugCommands.vmServices.serviceExtensionIsLoaded(VmServiceExtension.DebugBanner) === false, "Debug banner unloaded");
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

	it("can override platform", async () => {
		const config = await startDebugger(dc, flutterHelloWorldMainFile);
		await waitAllThrowIfTerminates(dc,
			dc.flutterAppStarted(),
			dc.configurationSequence(),
			dc.launch(config),
		);

		// Wait for Platform extension before trying to call it.
		await waitForResult(() => extApi.debugCommands.vmServices.serviceExtensionIsLoaded(VmServiceExtension.PlatformOverride), "Platform override loaded");

		const showQuickPick = sb.stub(vs.window, "showQuickPick");
		for (const platform of ["iOS", "android", "macOS", "linux"]) {
			showQuickPick.resolves({ platform });
			await vs.commands.executeCommand("flutter.overridePlatform");
			await ensureServiceExtensionValue(VmServiceExtension.PlatformOverride, platform, dc);
		}

		await waitAllThrowIfTerminates(dc,
			dc.waitForEvent("terminated"),
			dc.terminateRequest(),
		);
	});

	it("can toggle theme", async () => {
		const config = await startDebugger(dc, flutterHelloWorldMainFile);
		await waitAllThrowIfTerminates(dc,
			dc.flutterAppStarted(),
			dc.configurationSequence(),
			dc.launch(config),
		);

		// Wait for Brightness extension before trying to call it.
		await waitForResult(() => extApi.debugCommands.vmServices.serviceExtensionIsLoaded(VmServiceExtension.BrightnessOverride), "Brightness override loaded");

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

	it("re-sends theme on hot restart if set by us", async () => {
		const config = await startDebugger(dc, flutterHelloWorldMainFile);
		await waitAllThrowIfTerminates(dc,
			dc.flutterAppStarted(),
			dc.configurationSequence(),
			dc.launch(config),
		);

		await waitForResult(() => extApi.debugCommands.vmServices.serviceExtensionIsLoaded(VmServiceExtension.BrightnessOverride), "Waiting for BrightnessOverride extension", 60000);

		// Set the brightness to Dark through our toggle. This leaves us in control so we should
		// we-transmit it.
		await ensureServiceExtensionValue(VmServiceExtension.BrightnessOverride, "Brightness.light", dc);
		await vs.commands.executeCommand("flutter.toggleBrightness");
		await ensureServiceExtensionValue(VmServiceExtension.BrightnessOverride, "Brightness.dark", dc);

		// Hot restart, and wait for the service extension to come back.
		await vs.commands.executeCommand("flutter.hotRestart");
		await waitForResult(() => extApi.debugCommands.vmServices.serviceExtensionIsLoaded(VmServiceExtension.BrightnessOverride), "Brightness override loaded");
		await delay(100); // Allow time for the values to be re-sent.

		// Ensure the current value is still Dark (ie. we re-sent it).
		await ensureServiceExtensionValue(VmServiceExtension.BrightnessOverride, "Brightness.dark", dc);

		await waitAllThrowIfTerminates(dc,
			dc.waitForEvent("terminated"),
			dc.terminateRequest(),
		);
	});

	it("does not re-send theme on hot restart if set by someone else", async () => {
		const config = await startDebugger(dc, flutterHelloWorldMainFile);
		await waitAllThrowIfTerminates(dc,
			dc.flutterAppStarted(),
			dc.configurationSequence(),
			dc.launch(config),
		);

		await waitForResult(() => extApi.debugCommands.vmServices.serviceExtensionIsLoaded(VmServiceExtension.BrightnessOverride), "Waiting for BrightnessOverride extension", 60000);

		// First toggle the brightness ourselves, so we have a local override value.
		await ensureServiceExtensionValue(VmServiceExtension.BrightnessOverride, "Brightness.light", dc);
		await vs.commands.executeCommand("flutter.toggleBrightness");
		await ensureServiceExtensionValue(VmServiceExtension.BrightnessOverride, "Brightness.dark", dc);
		await vs.commands.executeCommand("flutter.toggleBrightness");
		await ensureServiceExtensionValue(VmServiceExtension.BrightnessOverride, "Brightness.light", dc);

		// Now set it directly (emulating another tool). This should drop our override so we would not re-send it.
		await extApi.debugCommands.vmServices.sendExtensionValue(dc.currentSession, VmServiceExtension.BrightnessOverride, "Brightness.dark");
		await ensureServiceExtensionValue(VmServiceExtension.BrightnessOverride, "Brightness.dark", dc);

		// Hot restart, and wait for the service extension to come back.
		await vs.commands.executeCommand("flutter.hotRestart");
		await waitForResult(() => extApi.debugCommands.vmServices.serviceExtensionIsLoaded(VmServiceExtension.BrightnessOverride), "Brightness override loaded");
		await delay(100); // Allow time for the values to be re-sent.

		// Ensure the current value has reverted (since it was the other tools job to re-send it, but in
		// this case that other tool is fake and did not).
		await ensureServiceExtensionValue(VmServiceExtension.BrightnessOverride, "Brightness.light", dc);

		await waitAllThrowIfTerminates(dc,
			dc.waitForEvent("terminated"),
			dc.terminateRequest(),
		);
	});

	it("can quit during a build", async () => {
		const config = await startDebugger(dc, flutterHelloWorldMainFile);
		const configSequence = dc.configurationSequence();
		// Kick off a build, but do not await it...
		void dc.launch(config);

		// Wait 5 seconds after configuration sequence completes to ensure the build is in progress...
		await configSequence;
		await delay(5000);

		// Send a disconnect request and ensure it happens within 5 seconds.
		await Promise.race([
			Promise.all([
				dc.waitForEvent("terminated"),
				dc.terminateRequest(),
			]),
			new Promise((resolve, reject) => setTimeout(() => reject(new Error("Did not complete terminateRequest within 5s")), 5000)),
		]);
	});

	it("receives the expected output", async () => {
		const config = await startDebugger(dc, flutterHelloWorldMainFile);
		await waitAllThrowIfTerminates(dc,
			dc.configurationSequence(),
			dc.assertOutputContains("stdout", "Hello, world!"),
			dc.assertOutputContains("console", "Logging from dart:developer!"),
			dc.assertOutputContains("console", "<<end_of_long_line>>"),
			dc.launch(config),
		);

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

	it("can hot reload with customRequest", async () => {
		const config = await startDebugger(dc, flutterHelloWorldMainFile);
		await waitAllThrowIfTerminates(dc,
			dc.flutterAppStarted(),
			watchPromise("hot_reloads_successfully->configurationSequence", dc.configurationSequence()),
			watchPromise("hot_reloads_successfully->launch", dc.launch(config)),
		);

		await watchPromise("hot_reloads_successfully->hotReload", dc.hotReload());

		await waitAllThrowIfTerminates(dc,
			watchPromise("hot_reloads_successfully->waitForEvent:terminated", dc.waitForEvent("terminated")),
			watchPromise("hot_reloads_successfully->terminateRequest", dc.terminateRequest()),
		);
	});

	it("can hot reload using command", async () => {
		const config = await startDebugger(dc, flutterHelloWorldMainFile);
		await waitAllThrowIfTerminates(dc,
			dc.flutterAppStarted(),
			watchPromise("hot_reloads_successfully->configurationSequence", dc.configurationSequence()),
			watchPromise("hot_reloads_successfully->launch", dc.launch(config)),
		);

		await vs.commands.executeCommand("flutter.hotReload");

		await waitAllThrowIfTerminates(dc,
			watchPromise("hot_reloads_successfully->waitForEvent:terminated", dc.waitForEvent("terminated")),
			watchPromise("hot_reloads_successfully->terminateRequest", dc.terminateRequest()),
		);
	});

	it("hot reloads on save", async () => {
		const config = await startDebugger(dc, flutterHelloWorldMainFile);
		await waitAllThrowIfTerminates(dc,
			dc.flutterAppStarted(),
			dc.configurationSequence(),
			dc.launch(config),
		);

		await delayBeforeRestart();
		await waitAllThrowIfTerminates(dc,
			dc.waitForHotReload(),
			saveTrivialChangeToFile(flutterHelloWorldMainFile),
		);

		await waitAllThrowIfTerminates(dc,
			dc.waitForEvent("terminated"),
			dc.terminateRequest(),
		);
	});

	it("hot reloads on save of custom glob", async () => {
		await setConfigForTest("dart", "hotReloadPatterns", ["**/*.md"]);
		const config = await startDebugger(dc, flutterHelloWorldMainFile);
		await waitAllThrowIfTerminates(dc,
			dc.flutterAppStarted(),
			dc.configurationSequence(),
			dc.launch(config),
		);

		await delayBeforeRestart();
		await waitAllThrowIfTerminates(dc,
			dc.waitForHotReload(),
			saveTrivialChangeToFile(flutterHelloWorldReadmeFile),
		);

		await waitAllThrowIfTerminates(dc,
			dc.waitForEvent("terminated"),
			dc.terminateRequest(),
		);
	});

	it("hot reloads on external modification of file", async () => {
		await setConfigForTest("dart", "previewHotReloadOnSaveWatcher", true);
		const config = await startDebugger(dc, flutterHelloWorldMainFile);
		await waitAllThrowIfTerminates(dc,
			dc.flutterAppStarted(),
			dc.configurationSequence(),
			dc.launch(config),
		);

		await delayBeforeRestart();
		await waitAllThrowIfTerminates(dc,
			dc.waitForHotReload(),
			makeTrivialChangeToFileDirectly(flutterHelloWorldMainFile),
		);

		await waitAllThrowIfTerminates(dc,
			dc.waitForEvent("terminated"),
			dc.terminateRequest(),
		);
	});

	it("can hot restart using customRequest", async () => {
		const config = await startDebugger(dc, flutterHelloWorldMainFile);
		await waitAllThrowIfTerminates(dc,
			dc.flutterAppStarted(),
			dc.configurationSequence(),
			dc.launch(config),
		);

		await delayBeforeRestart();
		await waitAllThrowIfTerminates(dc,
			dc.assertOutputContains("stdout", "Restarted app"),
			dc.customRequest("hotRestart"),
		);

		await delayBeforeRestart();
		await waitAllThrowIfTerminates(dc,
			dc.waitForEvent("terminated"),
			dc.terminateRequest(),
		);
	});

	it("can hot restart using command", async () => {
		const config = await startDebugger(dc, flutterHelloWorldMainFile);
		await waitAllThrowIfTerminates(dc,
			dc.flutterAppStarted(),
			dc.configurationSequence(),
			dc.launch(config),
		);

		await delayBeforeRestart();
		await waitAllThrowIfTerminates(dc,
			dc.assertOutputContains("stdout", "Restarted app"),
			vs.commands.executeCommand("flutter.hotRestart") as Promise<void>,
		);

		await waitAllThrowIfTerminates(dc,
			dc.waitForEvent("terminated"),
			dc.terminateRequest(),
		);
	});

	it("automatically spawns DevTools at startup", async function () {
		if (!extApi.flutterCapabilities.supportsDevToolsServerAddress)
			this.skip();

		assert.ok(extApi.devTools.devtoolsUrl);
		assert.ok((await extApi.devTools.devtoolsUrl).startsWith("http://"));
	});

	it("can launch DevTools externally", async () => {
		await setConfigForTest("dart", "devToolsLocation", "external");

		const openBrowserCommand = sb.stub(extApi.envUtils, "openInBrowser").resolves();

		const config = await startDebugger(dc, flutterHelloWorldMainFile);
		await waitAllThrowIfTerminates(dc,
			dc.flutterAppStarted(),
			watchPromise("assertOutputContains", dc.assertOutputContains("console", `Launching lib${path.sep}main.dart on ${deviceName} in debug mode...\n`)),
			watchPromise("configurationSequence", dc.configurationSequence()),
			watchPromise("launch", dc.launch(config)),
		);

		const devTools: { url: string, dispose: () => void } = await watchPromise("executeCommand", await vs.commands.executeCommand("dart.openDevTools"));
		assert.ok(openBrowserCommand.calledOnce);
		assert.ok(devTools);
		// Clean up DevTools if it wasn't being eagerly spawned.
		if (!extApi.workspaceContext.config.startDevToolsServerEagerly)
			defer("Dispose DevTools", devTools.dispose);
		assert.ok(devTools.url);

		const serverResponse = await watchPromise("fetch", extApi.webClient.fetch(devTools.url));
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
			dc.assertOutputContains("console", `Launching lib${path.sep}main.dart on ${deviceName} in debug mode...\n`),
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
			dc.assertOutputContains("console", `Launching lib${path.sep}main.dart on ${deviceName} in debug mode...\n`),
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

	const numReloads = 1;
	it(`stops at a breakpoint after each reload (${numReloads})`, async function () {
		if (!dc.isDartDap && extApi.flutterCapabilities?.version.startsWith("3.19")) {
			// This is known broken in Flutter 3.19 (for legacy DAP) so skip for this version and re-enable
			// for the next version.
			// https://github.com/dart-lang/sdk/issues/54925
			this.skip();
		}

		await openFile(flutterHelloWorldMainFile);
		const config = await startDebugger(dc, flutterHelloWorldMainFile);
		const expectedLocation = {
			line: positionOf("^// BREAKPOINT1").line, // positionOf is 0-based, and seems to want 1-based, BUT comment is on next line!
			path: fsPath(flutterHelloWorldMainFile),
		};
		await watchPromise("stops_at_a_breakpoint->hitBreakpoint", dc.hitBreakpoint(config, expectedLocation));
		const stack = await dc.getStack();
		const frames = stack.body.stackFrames;
		// Web/Flutter have slightly different representations of this
		// so allow either.
		if (frames[0].name.includes("."))
			assert.equal(frames[0].name, "MyHomePage.build");
		else
			assert.equal(frames[0].name, "build");
		assert.equal(frames[0].source!.path, expectedLocation.path);
		assert.equal(frames[0].source!.name, "package:flutter_hello_world/main.dart");

		await watchPromise("stops_at_a_breakpoint->resume", dc.resume());

		// Add some invalid breakpoints because in the past they've caused us issues
		// https://github.com/Dart-Code/Dart-Code/issues/1437.
		// We need to also include expectedLocation since this overwrites all BPs.
		await dc.setBreakpointsRequest({
			breakpoints: [{ line: 0 }, expectedLocation],
			source: { path: fsPath(flutterHelloWorldMainFile) },
		});

		// Reload and ensure we hit the breakpoint on each one.
		for (let i = 0; i < numReloads; i++) {
			await delay(2000); // TODO: Remove this attempt to see if reloading too fast is causing our flakes...
			await waitAllThrowIfTerminates(dc,
				watchPromise(`stops_at_a_breakpoint->reload:${i}->assertStoppedLocation:breakpoint`, dc.assertStoppedLocation("breakpoint", expectedLocation))
					.then(async () => {
						const stack = await watchPromise(`stops_at_a_breakpoint->reload:${i}->getStack`, dc.getStack());
						const frames = stack.body.stackFrames;
						// Web/Flutter have slightly different representations of this
						// so allow either.
						if (frames[0].name.includes("."))
							assert.equal(frames[0].name, "MyHomePage.build");
						else
							assert.equal(frames[0].name, "build");
						assert.equal(frames[0].source!.path, expectedLocation.path);
						assert.equal(frames[0].source!.name, "package:flutter_hello_world/main.dart");
					})
					.then(() => watchPromise(`stops_at_a_breakpoint->reload:${i}->resume`, dc.resume())),
				watchPromise(`stops_at_a_breakpoint->reload:${i}->hotReload:breakpoint`, dc.hotReload()),
			);
		}

		await waitAllThrowIfTerminates(dc,
			dc.waitForEvent("terminated"),
			dc.terminateRequest(),
		);
	});

	it("does not stop at a breakpoint in noDebug mode", async () => {
		await openFile(flutterHelloWorldMainFile);
		const config = await startDebugger(dc, flutterHelloWorldMainFile);
		config.noDebug = true;

		let didStop = false;

		dc.waitForEvent("stopped")
			.then(() => didStop = true)
			.catch(() => {
				// Swallow errors, as we don't care if this times out, we're only using it
				// to tell if we stopped by the time we hit the end of this test.
			});
		await waitAllThrowIfTerminates(dc,
			dc.waitForEvent("terminated"),
			dc.setBreakpointWithoutHitting(config, {
				line: positionOf("^// BREAKPOINT1").line + 1, // positionOf is 0-based, but seems to want 1-based
				path: fsPath(flutterHelloWorldMainFile),
				// TODO: This should be false in noDebug mode in SDK DAPs too.
				// verified: false,
			})
				.then(() => delay(10000))
				.then(() => dc.terminateRequest()),
		);

		assert.equal(didStop, false);
	});

	it("stops at a breakpoint in a part file");

	it("stops at a breakpoint in a deferred file");

	// Known not to work; https://github.com/Dart-Code/Dart-Code/issues/821
	it.skip("stops at a breakpoint in the SDK");

	it("stops at a breakpoint in an external package");

	it("steps into the SDK if debugSdkLibraries is true", async function () {
		if (flutterTestDeviceIsWeb)
			return this.skip(); // Web doesn't support setLibraryDebuggable

		await openFile(flutterHelloWorldMainFile);
		// Get location for `print`
		const printCall = positionOf("pri^nt(");
		const printDef = await getDefinition(printCall);
		const expectedPrintDefinitionPath = dc.isDartDap ? fsPath(uriFor(printDef)) : undefined;
		const config = await startDebugger(dc, flutterHelloWorldMainFile, { debugSdkLibraries: true });
		await dc.hitBreakpoint(config, {
			line: printCall.line + 1,
			path: fsPath(flutterHelloWorldMainFile),
		});
		await waitAllThrowIfTerminates(dc,
			dc.assertStoppedLocation("step", {
				path: expectedPrintDefinitionPath,
			}).then((response) => {
				// Ensure the top stack frame matches
				const frame = response.body.stackFrames[0];
				assert.equal(frame.name, "print");
				assert.equal(frame.source!.path, expectedPrintDefinitionPath);
				assert.equal(frame.source!.name, "dart:core/print.dart");
			}),
			dc.stepIn(),
		);

		await waitAllThrowIfTerminates(dc,
			dc.waitForEvent("terminated"),
			dc.terminateRequest(),
		);
	});

	it("does not step into the SDK if debugSdkLibraries is false", async function () {
		if (flutterTestDeviceIsWeb)
			return this.skip(); // Web doesn't support setLibraryDebuggable

		await openFile(flutterHelloWorldMainFile);
		// Get location for `print`
		const printCall = positionOf("pri^nt(");
		const config = await startDebugger(dc, flutterHelloWorldMainFile, { debugSdkLibraries: false });
		await dc.hitBreakpoint(config, {
			line: printCall.line + 1,
			path: fsPath(flutterHelloWorldMainFile),
		});
		await waitAllThrowIfTerminates(dc,
			dc.assertStoppedLocation("step", {
				// Ensure we stayed in the current file
				path: fsPath(flutterHelloWorldMainFile),
			}),
			dc.stepIn(),
		);

		await waitAllThrowIfTerminates(dc,
			dc.waitForEvent("terminated"),
			dc.terminateRequest(),
		);
	});

	it("steps into an external library if debugExternalPackageLibraries is true", async function () {
		if (flutterTestDeviceIsWeb)
			return this.skip(); // Web doesn't support setLibraryDebuggable

		await openFile(flutterHelloWorldHttpFile);
		// Get location for `http.read(`
		const httpReadCall = positionOf("http.re^ad(");
		const httpReadDef = await getDefinition(httpReadCall);
		const config = await startDebugger(dc, flutterHelloWorldHttpFile, { debugExternalPackageLibraries: true });
		await dc.hitBreakpoint(config, {
			line: httpReadCall.line + 1,
			path: fsPath(flutterHelloWorldHttpFile),
		});
		await waitAllThrowIfTerminates(dc,
			dc.assertStoppedLocation("step", {
				// Ensure we stepped into the external file
				path: fsPath(uriFor(httpReadDef)),
			}).then((response) => {
				// Ensure the top stack frame matches
				const frame = response.body.stackFrames[0];
				assert.equal(frame.name, "read");
				assert.equal(frame.source!.path, fsPath(uriFor(httpReadDef)));
				assert.equal(frame.source!.name, "package:http/http.dart");
			}),
			dc.stepIn(),
		);

		await waitAllThrowIfTerminates(dc,
			dc.waitForEvent("terminated"),
			dc.terminateRequest(),
		);
	});

	it("does not step into an external library if debugExternalPackageLibraries is false", async function () {
		if (flutterTestDeviceIsWeb)
			return this.skip(); // Web doesn't support setLibraryDebuggable

		await openFile(flutterHelloWorldHttpFile);
		// Get location for `http.read(`
		const httpReadCall = positionOf("http.re^ad(");
		const config = await startDebugger(dc, flutterHelloWorldHttpFile, { debugExternalPackageLibraries: false });
		await dc.hitBreakpoint(config, {
			line: httpReadCall.line,
			path: fsPath(flutterHelloWorldHttpFile),
		});
		await waitAllThrowIfTerminates(dc,
			dc.assertStoppedLocation("step", {
				// Ensure we stayed in the current file
				path: fsPath(flutterHelloWorldHttpFile),
			}),
			dc.stepIn(),
		);

		await waitAllThrowIfTerminates(dc,
			dc.waitForEvent("terminated"),
			dc.terminateRequest(),
		);
	});

	it("steps into a local library even if debugExternalPackageLibraries is false", async function () {
		if (flutterTestDeviceIsWeb)
			return this.skip(); // Web doesn't support setLibraryDebuggable

		await openFile(flutterHelloWorldLocalPackageFile);
		// Get location for `printMyThing()`
		const printMyThingCall = positionOf("printMy^Thing(");
		const printMyThingDef = await getDefinition(printMyThingCall);
		const config = await startDebugger(dc, flutterHelloWorldLocalPackageFile, {
			// Override this since it's not really open in the workspace.
			additionalProjectPaths: [fsPath(myPackageFolder)],
			debugExternalPackageLibraries: false,
		});
		await dc.hitBreakpoint(config, {
			line: printMyThingCall.line + 1,
			path: fsPath(flutterHelloWorldLocalPackageFile),
		});
		await waitAllThrowIfTerminates(dc,
			dc.assertStoppedLocation("step", {
				// Ensure we stepped into the external file
				path: fsPath(uriFor(printMyThingDef)),
			}).then((response) => {
				// Ensure the top stack frame matches
				const frame = response.body.stackFrames[0];
				assert.equal(frame.name, "printMyThing");
				assert.equal(frame.source!.path, fsPath(uriFor(printMyThingDef)));
				assert.equal(frame.source!.name, "package:my_package/my_thing.dart");
			}),
			dc.stepIn(),
		);

		await waitAllThrowIfTerminates(dc,
			dc.waitForEvent("terminated"),
			dc.terminateRequest(),
		);
	});

	it("downloads SDK source code from the VM");

	it("correctly marks non-debuggable SDK frames when debugSdkLibraries is false", async function () {
		if (flutterTestDeviceIsWeb)
			return this.skip(); // Web doesn't have any SDK frames here.

		await openFile(flutterHelloWorldThrowInSdkFile);
		const config = await startDebugger(dc, flutterHelloWorldThrowInSdkFile, { debugSdkLibraries: false });
		await waitAllThrowIfTerminates(dc,
			dc.waitForEvent("initialized")
				.then(() => dc.setExceptionBreakpointsRequest({ filters: ["All"] }))
				.then(() => dc.configurationDoneRequest()),
			dc.waitForEvent("stopped"),
			dc.launch(config),
		);
		const stack = await dc.getStack();
		ensureFrameCategories(stack.body.stackFrames.filter(isSdkFrame), "deemphasize", "from the SDK");
		ensureFrameCategories(stack.body.stackFrames.filter(isUserCode), undefined, undefined);

		await waitAllThrowIfTerminates(dc,
			dc.waitForEvent("terminated"),
			dc.terminateRequest(),
		);
	});

	it("correctly marks debuggable SDK frames when debugSdkLibraries is true", async function () {
		if (flutterTestDeviceIsWeb)
			return this.skip(); // Web doesn't support setLibraryDebuggable so doesn't break in the SDK.

		await openFile(flutterHelloWorldThrowInSdkFile);
		const config = await startDebugger(dc, flutterHelloWorldThrowInSdkFile, { debugSdkLibraries: true });
		await waitAllThrowIfTerminates(dc,
			dc.waitForEvent("initialized")
				.then(() => dc.setExceptionBreakpointsRequest({ filters: ["All"] }))
				.then(() => dc.configurationDoneRequest()),
			dc.waitForEvent("stopped"),
			dc.launch(config),
		);
		const stack = await dc.getStack();
		ensureFrameCategories(stack.body.stackFrames.filter(isSdkFrame), undefined, "from the SDK");
		ensureFrameCategories(stack.body.stackFrames.filter(isUserCode), undefined, undefined);

		await waitAllThrowIfTerminates(dc,
			dc.waitForEvent("terminated"),
			dc.terminateRequest(),
		);
	});

	it("correctly marks non-debuggable external library frames when debugExternalPackageLibraries is false", async () => {
		await openFile(flutterHelloWorldThrowInExternalPackageFile);
		const config = await startDebugger(dc, flutterHelloWorldThrowInExternalPackageFile, { debugExternalPackageLibraries: false });
		await waitAllThrowIfTerminates(dc,
			dc.waitForEvent("initialized")
				.then(() => dc.setExceptionBreakpointsRequest({ filters: ["All"] }))
				.then(() => dc.configurationDoneRequest()),
			dc.waitForEvent("stopped"),
			dc.launch(config),
		);
		const stack = await dc.getStack();
		ensureFrameCategories(stack.body.stackFrames.filter(isExternalPackage), "deemphasize", "from external packages");
		ensureFrameCategories(stack.body.stackFrames.filter(isUserCode), undefined, undefined);

		await waitAllThrowIfTerminates(dc,
			dc.waitForEvent("terminated"),
			dc.terminateRequest(),
		);
	});

	it("correctly marks debuggable external library frames when debugExternalPackageLibraries is true", async () => {
		await openFile(flutterHelloWorldThrowInExternalPackageFile);
		const config = await startDebugger(dc, flutterHelloWorldThrowInExternalPackageFile, { debugExternalPackageLibraries: true });
		await waitAllThrowIfTerminates(dc,
			dc.waitForEvent("initialized")
				.then(() => dc.setExceptionBreakpointsRequest({ filters: ["All"] }))
				.then(() => dc.configurationDoneRequest()),
			dc.waitForEvent("stopped"),
			dc.launch(config),
		);
		const stack = await dc.getStack();
		ensureFrameCategories(stack.body.stackFrames.filter(isExternalPackage), undefined, "from external packages");
		ensureFrameCategories(stack.body.stackFrames.filter(isUserCode), undefined, undefined);

		await waitAllThrowIfTerminates(dc,
			dc.waitForEvent("terminated"),
			dc.terminateRequest(),
		);
	});

	it("correctly marks debuggable local library frames even when debugExternalPackageLibraries is false", async () => {
		await openFile(flutterHelloWorldThrowInLocalPackageFile);
		const config = await startDebugger(dc, flutterHelloWorldThrowInLocalPackageFile, {
			// Override this since it's not really open in the workspace.
			additionalProjectPaths: [fsPath(myPackageFolder)],
			debugExternalPackageLibraries: false,
		});
		await waitAllThrowIfTerminates(dc,
			dc.waitForEvent("initialized")
				.then(() => dc.setExceptionBreakpointsRequest({ filters: ["All"] }))
				.then(() => dc.configurationDoneRequest()),
			dc.waitForEvent("stopped"),
			dc.launch(config),
		);
		const stack = await dc.getStack();
		ensureFrameCategories(stack.body.stackFrames.filter(isLocalPackage), undefined, undefined);
		ensureFrameCategories(stack.body.stackFrames.filter(isUserCode), undefined, undefined);

		await waitAllThrowIfTerminates(dc,
			dc.waitForEvent("terminated"),
			dc.terminateRequest(),
		);
	});

	it("can fetch slices of stack frames", async () => {
		// TODO: This might be unreliable until dev channel gets this.
		const expectFullCount = !versionIsAtLeast(extApi.dartCapabilities.version, "2.12.0-0");

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
		// For Flutter web, each frame appears twice, so handle that for now while waiting to hear
		// if that's expected.
		const frameMultiplier = frameNames[0] === frameNames[1] ? 2 : 1;
		for (let i = 0; i < 60; i++)
			assert.equal(frameNames[i * frameMultiplier], `func${60 - i}`);
	});

	function testBreakpointCondition(condition: string, shouldStop: boolean, expectedError?: string) {
		return async () => {
			await openFile(flutterHelloWorldMainFile);
			const config = await startDebugger(dc, flutterHelloWorldMainFile);

			let didStop = false;

			dc.waitForEvent("stopped")
				.then(() => didStop = true)
				.catch(() => {
					// Swallow errors, as we don't care if this times out, we're only using it
					// to tell if we stopped by the time we hit the end of this test.
				});

			let expectation: Promise<any> = resolvedPromise;
			if (shouldStop)
				expectation = expectation.then(() => dc.waitForEvent("stopped"));

			if (expectedError)
				expectation = expectation.then(() => dc.assertOutputContains("console", expectedError));

			// If we don't have another expectation, then we need to keep running for some period
			// after launch to ensure we didn't stop unexpectedly.
			let waitAfterLaunch = 0;
			if (expectation === resolvedPromise)
				waitAfterLaunch = 10000;

			await waitAllThrowIfTerminates(
				dc,
				dc.waitForEvent("initialized")
					.then(() => dc.setBreakpointsRequest({
						// positionOf is 0-based, but seems to want 1-based
						breakpoints: [{
							condition,
							line: positionOf("^// BREAKPOINT1").line,
						}],
						source: { path: fsPath(flutterHelloWorldMainFile) },
					}))
					.then(() => dc.configurationDoneRequest()),
				expectation,
				dc.launch(config)
			)
				.then(() => delay(waitAfterLaunch));

			await waitAllThrowIfTerminates(dc,
				dc.waitForEvent("terminated"),
				dc.terminateRequest(),
			);

			assert.equal(didStop, shouldStop);
		};
	}

	it("stops at a breakpoint with a condition returning true", testBreakpointCondition("1 == 1", true));
	it("stops at a breakpoint with a condition returning 1", testBreakpointCondition("3 - 2", true));
	it("does not stop at a breakpoint with a condition returning a string", testBreakpointCondition("'test'", false));
	it("does not stop at a breakpoint with a condition returning false", testBreakpointCondition("1 == 0", false));
	it("does not stop at a breakpoint with a condition returning 0", testBreakpointCondition("3 - 3", false));
	it("does not stop at a breakpoint with a condition returning null", testBreakpointCondition("print('test');", false));
	it("reports errors evaluating breakpoint conditions", testBreakpointCondition("1 + '1'", false, `Debugger failed to evaluate breakpoint condition "1 + '1'"`));

	it("logs expected text (and does not stop) at a logpoint", async () => {
		await openFile(flutterHelloWorldMainFile);
		const config = await startDebugger(dc, flutterHelloWorldMainFile);

		let didStop = false;

		dc.waitForEvent("stopped")
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

	it("provides local variables when stopped at a breakpoint", async () => {
		await openFile(flutterHelloWorldMainFile);
		const debugConfig = await startDebugger(dc, flutterHelloWorldMainFile);
		await dc.hitBreakpoint(debugConfig, {
			line: positionOf("^// BREAKPOINT1").line,
			path: fsPath(flutterHelloWorldMainFile),
		});

		const variables = await dc.getTopFrameVariables("Locals");
		ensureVariable(variables, "l", "l", `List (12 items)`);
		ensureVariable(variables, "longStrings", "longStrings", `List (1 item)`);
		ensureVariable(variables, "tenDates", "tenDates", `List (10 items)`);
		ensureVariable(variables, "hundredDates", "hundredDates", `List (100 items)`);
		ensureVariable(variables, "s", "s", `"Hello!"`);
		ensureVariable(variables, "m", "m", `Map (10 items)`);

		const listVariables = await dc.getVariables(variables.find((v) => v.name === "l")!.variablesReference);
		for (let i = 0; i <= 1; i++) {
			ensureVariableWithIndex(listVariables, i, `l[${i}]`, `[${i}]`, `${i}`);
		}

		// TODO: Remove this condition when web truncates variables
		if (!flutterTestDeviceIsWeb) {
			const longStringListVariables = await dc.getVariables(variables.find((v) => v.name === "longStrings")!.variablesReference);
			ensureVariable(longStringListVariables, "longStrings[0]", "[0]", {
				ends: "…\"", // String is truncated here.
				starts: "\"This is a long string that is 300 characters!",
			});
		} else {
			console.warn(`Skipping long string check for Chrome...`);
		}

		const shortdateListVariables = await dc.getVariables(variables.find((v) => v.name === "tenDates")!.variablesReference);
		ensureVariable(shortdateListVariables, "tenDates[0]", "[0]", "DateTime (2005-01-01 00:00:00.000)");

		const mapVariables = await dc.getVariables(variables.find((v) => v.name === "m")!.variablesReference);
		ensureVariable(mapVariables, undefined, "0", `"l" -> List (12 items)`);
		ensureVariable(mapVariables, undefined, "1", `"longStrings" -> List (1 item)`);
		ensureVariable(mapVariables, undefined, "2", `"tenDates" -> List (10 items)`);
		ensureVariable(mapVariables, undefined, "3", `"hundredDates" -> List (100 items)`);
		ensureVariable(mapVariables, undefined, "4", `"s" -> "Hello!"`);
		ensureVariable(mapVariables, undefined, "5", dc.isDartDap ? `DateTime (2000-02-14 00:00:00.000) -> "valentines-2000"` : `DateTime -> "valentines-2000"`);
		ensureVariable(mapVariables, undefined, "6", dc.isDartDap ? `DateTime (2005-01-01 00:00:00.000) -> "new-year-2005"` : `DateTime -> "new-year-2005"`);
		ensureVariable(mapVariables, undefined, "7", `true -> true`);
		ensureVariable(mapVariables, undefined, "8", `1 -> "one"`);
		ensureVariable(mapVariables, undefined, "9", `1.1 -> "one-point-one"`);

		await ensureMapEntry(mapVariables, {
			key: { evaluateName: undefined, name: "key", value: `"l"` },
			value: { evaluateName: `m["l"]`, name: "value", value: "List (12 items)" },
		}, dc);
		await ensureMapEntry(mapVariables, {
			key: { evaluateName: undefined, name: "key", value: `"longStrings"` },
			value: { evaluateName: `m["longStrings"]`, name: "value", value: "List (1 item)" },
		}, dc);
		await ensureMapEntry(mapVariables, {
			key: { evaluateName: undefined, name: "key", value: `"s"` },
			value: { evaluateName: `m["s"]`, name: "value", value: `"Hello!"` },
		}, dc);
		await ensureMapEntry(mapVariables, {
			key: { evaluateName: undefined, name: "key", value: `DateTime (2000-02-14 00:00:00.000)` },
			value: { evaluateName: undefined, name: "value", value: `"valentines-2000"` },
		}, dc);
		await ensureMapEntry(mapVariables, {
			key: { evaluateName: undefined, name: "key", value: `DateTime (2005-01-01 00:00:00.000)` },
			value: { evaluateName: undefined, name: "value", value: `"new-year-2005"` },
		}, dc);
		await ensureMapEntry(mapVariables, {
			key: { evaluateName: undefined, name: "key", value: "true" },
			value: { evaluateName: `m[true]`, name: "value", value: "true" },
		}, dc);
		await ensureMapEntry(mapVariables, {
			key: { evaluateName: undefined, name: "key", value: "1" },
			value: { evaluateName: `m[1]`, name: "value", value: `"one"` },
		}, dc);
		await ensureMapEntry(mapVariables, {
			key: { evaluateName: undefined, name: "key", value: "1.1" },
			value: { evaluateName: `m[1.1]`, name: "value", value: `"one-point-one"` },
		}, dc);

		await waitAllThrowIfTerminates(dc,
			dc.waitForEvent("terminated"),
			dc.terminateRequest(),
		);
	});

	it("excludes type args from local variables when stopped at a breakpoint in a generic method", async function () {
		// https://github.com/dart-lang/webdev/issues/2340
		if (flutterTestDeviceIsWeb)
			return this.skip();

		await openFile(flutterHelloWorldMainFile);
		const debugConfig = await startDebugger(dc, flutterHelloWorldMainFile);
		await dc.hitBreakpoint(debugConfig, {
			line: positionOf("^// BREAKPOINT2").line, // positionOf is 0-based, but seems to want 1-based
			path: fsPath(flutterHelloWorldMainFile),
		});

		const variables = await dc.getTopFrameVariables("Locals");
		ensureVariable(variables, "a", "a", `1`);
		// Ensure there were no others.
		assert.equal(variables.length, 1);

		await waitAllThrowIfTerminates(dc,
			dc.waitForEvent("terminated"),
			dc.terminateRequest(),
		);
	});

	it("includes fields and getters in variables when stopped at a breakpoint", async function () {
		if (flutterTestDeviceIsWeb)
			return this.skip(); // Requires https://dart-review.googlesource.com/c/sdk/+/330784

		await openFile(flutterHelloWorldGettersFile);
		const config = await startDebugger(dc, flutterHelloWorldGettersFile);
		await dc.hitBreakpoint(config, {
			line: positionOf("^// BREAKPOINT1").line + 1, // positionOf is 0-based, but seems to want 1-based
			path: fsPath(flutterHelloWorldGettersFile),
		});

		const variables = await dc.getTopFrameVariables("Locals");
		ensureVariable(variables, "danny", "danny", `Danny`);

		const classInstance = await dc.getVariables(variables.find((v) => v.name === "danny")!.variablesReference);
		// Fields
		ensureVariable(classInstance, "danny.field", "field", `"field"`);
		ensureVariable(classInstance, "danny.baseField", "baseField", `"baseField"`);
		// Getters
		ensureVariable(classInstance, "danny.kind", "kind", `"Person"`);
		// TODO: Remove this Linux-skip when this bug is fixed:
		// https://github.com/dart-lang/sdk/issues/39330
		if (!isLinux)
			ensureVariable(classInstance, "danny.name", "name", `"Danny"`);
		ensureVariable(classInstance, undefined, "throws", { starts: "<Oops!" });

		await waitAllThrowIfTerminates(dc,
			dc.waitForEvent("terminated"),
			dc.terminateRequest(),
		);
	});

	it("includes fields but not getters in variables when evaluateGettersInDebugViews=false+showGettersInDebugViews=false", async () => {
		await setConfigForTest("dart", "evaluateGettersInDebugViews", false);
		await setConfigForTest("dart", "showGettersInDebugViews", false);

		await openFile(flutterHelloWorldGettersFile);
		const config = await startDebugger(dc, flutterHelloWorldGettersFile);
		await dc.hitBreakpoint(config, {
			line: positionOf("^// BREAKPOINT1").line + 1, // positionOf is 0-based, but seems to want 1-based
			path: fsPath(flutterHelloWorldGettersFile),
		});

		const variables = await dc.getTopFrameVariables("Locals");
		ensureVariable(variables, "danny", "danny", `Danny`);

		const classInstance = await dc.getVariables(variables.find((v) => v.name === "danny")!.variablesReference);
		// Fields
		ensureVariable(classInstance, "danny.field", "field", `"field"`);
		ensureVariable(classInstance, "danny.baseField", "baseField", `"baseField"`);
		// No getters
		ensureNoVariable(classInstance, "kind");
		ensureNoVariable(classInstance, "name");
		ensureNoVariable(classInstance, "throws");

		await waitAllThrowIfTerminates(dc,
			dc.waitForEvent("terminated"),
			dc.terminateRequest(),
		);
	});

	// Currently skipped because we sometimes get different text from locals, eg.:
	// "StatelessElement" vs "StatelessElement (MyHomepage(dirty))" 🤔
	it.skip("watch expressions provide same info as locals", async () => {
		await openFile(flutterHelloWorldMainFile);
		const config = await startDebugger(dc, flutterHelloWorldMainFile);
		await dc.hitBreakpoint(config, {
			line: positionOf("^// BREAKPOINT1").line,
			path: fsPath(flutterHelloWorldMainFile),
		});

		const variables = await dc.getTopFrameVariables("Locals");

		for (const variable of variables) {
			const evaluateName = (variable as any).evaluateName as string | undefined;
			if (!evaluateName)
				continue;
			const evaluateResult = await dc.evaluateForFrame(evaluateName);
			assert.ok(evaluateResult);
			assert.equal(evaluateResult.result, variable.value);
			assert.equal(!!evaluateResult.variablesReference, !!variable.variablesReference);
		}

		await waitAllThrowIfTerminates(dc,
			dc.waitForEvent("terminated"),
			dc.terminateRequest(),
		);
	});

	it("evaluateName evaluates to the expected value", async () => {
		await openFile(flutterHelloWorldMainFile);
		const config = await startDebugger(dc, flutterHelloWorldMainFile);
		await dc.hitBreakpoint(config, {
			line: positionOf("^// BREAKPOINT1").line,
			path: fsPath(flutterHelloWorldMainFile),
		});

		const variables = await dc.getTopFrameVariables("Locals");
		const listVariables = await dc.getVariables(variables.find((v) => v.name === "l")!.variablesReference);
		const listLongstringVariables = await dc.getVariables(variables.find((v) => v.name === "longStrings")!.variablesReference);
		const mapVariables = await dc.getVariables(variables.find((v) => v.name === "m")!.variablesReference);
		const allVariables = listVariables.concat(listLongstringVariables).concat(mapVariables);

		for (const variable of allVariables) {
			const evaluateName = (variable as any).evaluateName as string | undefined;
			if (!evaluateName)
				continue;
			const evaluateResult = await dc.evaluateForFrame(evaluateName);
			assert.ok(evaluateResult);
			if (variable.value.endsWith("…\"")) {
				// If the value was truncated, the evaluate responses should be longer
				const prefix = variable.value.slice(1, -2); // Strip quotes
				assert.ok(evaluateResult.result.length > prefix.length);
				assert.equal(evaluateResult.result.slice(1, prefix.length + 1), prefix);
			} else {
				// Otherwise it should be the same.
				assert.equal(evaluateResult.result, variable.value);
			}
			assert.equal(!!evaluateResult.variablesReference, !!variable.variablesReference);
		}

		await waitAllThrowIfTerminates(dc,
			dc.waitForEvent("terminated"),
			dc.terminateRequest(),
		);
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

	it("stops on exception", async function () {
		if (flutterTestDeviceIsWeb)
			return this.skip(); // Currently fails on web as it doesn't pause on the exception.

		await openFile(flutterHelloWorldBrokenFile);
		const config = await startDebugger(dc, flutterHelloWorldBrokenFile);
		await waitAllThrowIfTerminates(dc,
			dc.configurationSequence(),
			dc.assertStoppedLocation("exception", {
				line: positionOf("^Oops").line + 1, // positionOf is 0-based, but seems to want 1-based
				path: fsPath(flutterHelloWorldBrokenFile),
			}),
			dc.launch(config),
		);

		await waitAllThrowIfTerminates(dc,
			dc.waitForEvent("terminated"),
			dc.terminateRequest(),
		);
	});

	it("does not stop on exception in noDebug mode", async () => {
		await openFile(flutterHelloWorldBrokenFile);
		const config = await startDebugger(dc, flutterHelloWorldBrokenFile);
		config.noDebug = true;

		let didStop = false;

		dc.waitForEvent("stopped")
			.then(() => didStop = true)
			.catch(() => {
				// Swallow errors, as we don't care if this times out, we're only using it
				// to tell if we stopped by the time we hit the end of this test.
			});

		await waitAllThrowIfTerminates(dc,
			dc.debuggerReady()
				.then(() => delay(10000))
				.then(() => dc.terminateRequest()),
			dc.configurationSequence(),
			dc.waitForEvent("terminated"),
			dc.launch(config),
		);

		assert.equal(didStop, false);
	});

	// Skipped due to https://github.com/flutter/flutter/issues/17007.
	it.skip("provides exception details when stopped on exception", async () => {
		await openFile(flutterHelloWorldBrokenFile);
		const config = await startDebugger(dc, flutterHelloWorldBrokenFile);
		await waitAllThrowIfTerminates(dc,
			dc.configurationSequence(),
			dc.assertStoppedLocation("exception", {
				line: positionOf("^won't find this").line + 1, // positionOf is 0-based, but seems to want 1-based
				path: fsPath(flutterHelloWorldBrokenFile),
			}),
			dc.launch(config),
		);

		const variables = await dc.getTopFrameVariables("Exceptions");
		ensureVariable(variables, "$_threadException.message", "message", `"(TODO WHEN UNSKIPPING)"`);

		await waitAllThrowIfTerminates(dc,
			dc.waitForEvent("terminated"),
			dc.terminateRequest(),
		);
	});

	it("writes exception to output", async () => {
		await openFile(flutterHelloWorldBrokenFile);
		const config = await startDebugger(dc, flutterHelloWorldBrokenFile);
		config.noDebug = true;

		await waitAllThrowIfTerminates(dc,
			watchPromise("writes_failure_output->configurationSequence", dc.configurationSequence()),
			watchPromise("writes_failure_output->assertOutputContains", dc.assertOutputContains(undefined, "Exception: Oops\n")),
			watchPromise("writes_failure_output->launch", dc.launch(config)),
		);

		await waitAllThrowIfTerminates(dc,
			dc.waitForEvent("terminated"),
			dc.terminateRequest(),
		);
	});

	it("adds metadata for known files in call stacks", async function () {
		if (flutterTestDeviceIsWeb)
			return this.skip(); // https://github.com/dart-lang/webdev/issues/949

		await openFile(flutterHelloWorldBrokenFile);
		const config = await startDebugger(dc, flutterHelloWorldBrokenFile);

		await waitAllThrowIfTerminates(dc,
			// Disable breaking on exceptions so we don't have to resume.
			dc.waitForEvent("initialized")
				.then(() => dc.setExceptionBreakpointsRequest({ filters: ["None"] }))
				.then(() => dc.configurationDoneRequest()),
			watchPromise(
				"writes_failure_output->assertOutputContains",
				dc.assertOutputContains(undefined, "_throwAnException")
					.then((event) => {
						assert.equal(event.body.source!.name, "package:flutter_hello_world/broken.dart");
						assert.equal(event.body.source!.path, fsPath(flutterHelloWorldBrokenFile));
						assert.equal(event.body.line, positionOf("^Oops").line + 1); // positionOf is 0-based, but seems to want 1-based
						assert.equal(event.body.column, 5);
					}),
			),
			watchPromise("writes_failure_output->launch", dc.launch(config)),
		);

		await waitAllThrowIfTerminates(dc,
			dc.waitForEvent("terminated"),
			dc.terminateRequest(),
		);
	});

	it("renders correct output for structured errors", async function () {
		if (!extApi.flutterCapabilities.hasLatestStructuredErrorsWork)
			return this.skip();

		// Currently this test fails on Chrome because we always lose the race
		// with enabling structured errors versus the error occurring
		if (flutterTestDeviceIsWeb)
			return this.skip();

		await openFile(flutterHelloWorldBrokenFile);
		const config = await startDebugger(dc, flutterHelloWorldBrokenFile);

		// Collect all output.
		let allOutput = "";
		const handleOutput = (event: DebugProtocol.OutputEvent) => {
			allOutput += `${event.body.category}: ${event.body.output}`;
		};
		dc.on("output", handleOutput);
		try {
			await waitAllThrowIfTerminates(dc,
				dc.flutterAppStarted(),
				// Disable breaking on exceptions so we don't have to resume.
				dc.waitForEvent("initialized")
					.then(() => dc.setExceptionBreakpointsRequest({ filters: ["None"] }))
					.then(() => dc.configurationDoneRequest()),
				dc.launch(config),
			);

			await waitForResult(
				() => allOutput.toLowerCase().includes("exception caught by widgets library")
					&& allOutput.includes("════════════════════════════════════════════════════════════════════════════════"),
				"Waiting for error output",
				20000,
			);
		} finally {
			dc.removeListener("output", handleOutput);
		}

		await waitAllThrowIfTerminates(dc,
			dc.waitForEvent("terminated"),
			dc.terminateRequest(),
		);

		// Grab online the lines that form our error.
		let stdErrLines = allOutput.split("\n").map((l) => l.trim());
		// Trim off stuff before our error.
		const firstErrorLine = stdErrLines.findIndex((l) => l.toLowerCase().includes("exception caught by widgets library"));
		stdErrLines = stdErrLines.slice(firstErrorLine);
		// Trim off stuff after our error.
		const lastErrorLine = stdErrLines.findIndex((l) => l.includes("════════════════════════════════════════════════════════════════════════════════"));
		stdErrLines = stdErrLines.slice(0, lastErrorLine + 1);

		// Because we run in verbose mode, there may be timings on the front, so trim them off.
		const timingRegex = new RegExp("\[[ \d]+\] ", "g");
		stdErrLines = stdErrLines.map((line) => line.replace(timingRegex, ""));

		const expectedErrorLines = dc.isDartDap && extApi.flutterCapabilities.hasSdkDapWithStructuredErrors
			? [
				`stderr: ════════ Exception caught by widgets library ═══════════════════════════════════`,
				`stdout: The following _Exception was thrown building MyBrokenHomePage(dirty):`,
				`stderr: Exception: Oops`,
				`stdout:`,
				`The relevant error-causing widget was:`,
				`MyBrokenHomePage MyBrokenHomePage:${flutterHelloWorldBrokenFile.toString(true)}:11:13`,
				``,
				`When the exception was thrown, this was the stack:`,
				`stdout: #0      MyBrokenHomePage._throwAnException (package:flutter_hello_world/broken.dart:26:5)`,
				`stdout: #1      MyBrokenHomePage.build (package:flutter_hello_world/broken.dart:21:5)`,
				// Don't check any more past this, since they can change with Flutter framework changes.
			]
			: dc.isDartDap
				? [
					`stderr: ══╡ exception caught by widgets library ╞═══════════════════════════════════════════════════════════`,
					`stderr: The following _Exception was thrown building MyBrokenHomePage(dirty):`,
					`stderr: Exception: Oops`,
					`stderr:`,
					`stderr: The relevant error-causing widget was:`,
					`stderr:   MyBrokenHomePage`,
					`stderr:   MyBrokenHomePage:${flutterHelloWorldBrokenFile.toString(true)}:11:13`,
					`stderr:`,
					`stderr: When the exception was thrown, this was the stack:`,
					`stderr: #0      MyBrokenHomePage._throwAnException (package:flutter_hello_world/broken.dart:26:5)`,
					`stderr: #1      MyBrokenHomePage.build (package:flutter_hello_world/broken.dart:21:5)`,
					// Don't check any more past this, since they can change with Flutter framework changes.
				]
				: [
					`stderr: ════════ Exception caught by widgets library ═══════════════════════════════════`,
					`stdout: The following _Exception was thrown building MyBrokenHomePage(dirty):`,
					`stderr: Exception: Oops`,
					`stdout:`,
					`stdout: The relevant error-causing widget was`,
					`stdout: MyBrokenHomePage`,
					`stdout: When the exception was thrown, this was the stack`,
					`stdout: #0      MyBrokenHomePage._throwAnException`,
					`stdout: #1      MyBrokenHomePage.build`,
					`stdout: ${faint("#2      StatelessElement.build")}`,
					`stdout: ${faint("#3      ComponentElement.performRebuild")}`,
					`stdout: ${faint("#4      Element.rebuild")}`,
					// Don't check any more past this, since they can change with Flutter framework changes.
				];

		assert.deepStrictEqual(
			// Only check top expectedErrorLines.length to avoid all the frames that are
			// likely to change with Flutter changes.
			stdErrLines.slice(0, expectedErrorLines.length).map((s) => s.toLowerCase()),
			expectedErrorLines.map((s) => s.toLowerCase()),
		);
	});
});
