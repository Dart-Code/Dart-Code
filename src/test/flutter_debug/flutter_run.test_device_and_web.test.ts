import { DebugProtocol } from "@vscode/debugprotocol";
import { strict as assert } from "assert";
import * as path from "path";
import * as vs from "vscode";
import { isLinux } from "../../shared/constants";
import { DebuggerType, VmService, VmServiceExtension } from "../../shared/enums";
import { faint } from "../../shared/utils/colors";
import { fsPath } from "../../shared/utils/fs";
import { resolvedPromise, waitFor } from "../../shared/utils/promises";
import { DartDebugClient } from "../dart_debug_client";
import { createDebugClient, ensureFrameCategories, ensureMapEntry, ensureNoVariable, ensureVariable, ensureVariableWithIndex, flutterTestDeviceId, flutterTestDeviceIsWeb, isExternalPackage, isLocalPackage, isSdkFrame, isUserCode, killFlutterTester, startDebugger, waitAllThrowIfTerminates } from "../debug_helpers";
import { activateWithoutAnalysis, deferUntilLast, delay, flutterHelloWorldBrokenFile, flutterHelloWorldGettersFile, flutterHelloWorldHttpFile, flutterHelloWorldLocalPackageFile, flutterHelloWorldMainFile, flutterHelloWorldThrowInExternalPackageFile, flutterHelloWorldThrowInLocalPackageFile, flutterHelloWorldThrowInSdkFile, getDefinition, getPackages, myPackageFolder, openFile, positionOf, privateApi, setConfigForTest, uriFor, waitForResult, watchPromise } from "../helpers";

const deviceName = flutterTestDeviceIsWeb ? "Chrome" : "Flutter test device";

describe(`flutter run debugger (launch on ${flutterTestDeviceId})`, () => {
	before("get packages", () => getPackages());
	beforeEach("activate flutterHelloWorldMainFile", () => activateWithoutAnalysis(flutterHelloWorldMainFile));

	beforeEach("Wait for device to be available", async () => {
		// For web, the device doesn't show up immediately so we need to wait
		// otherwise we will prompt to select a device when starting the debug
		// session in the test. This is not required for flutter-tester as that
		// bypasses the device check.
		if (flutterTestDeviceIsWeb)
			await waitFor(() => privateApi.deviceManager!.getDevice(flutterTestDeviceId));
	});

	let dc: DartDebugClient;
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
	});

	beforeEach(() => {
		deferUntilLast("Kill flutter_tester", () => watchPromise("Killing flutter_tester processes", killFlutterTester()));
	});

	/// If we restart too fast, things fail :-/
	const delayBeforeRestart = () => delay(1000);

	it("runs and remains active until told to quit", async () => {
		const config = await startDebugger(dc, flutterHelloWorldMainFile);
		await waitAllThrowIfTerminates(dc,
			dc.assertOutputContains("console", `Launching lib${path.sep}main.dart on ${deviceName} in debug mode...\n`),
			dc.flutterAppStarted(),
			dc.configurationSequence(),
			dc.launch(config),
		);

		// Ensure we're still responsive after 1 second.
		await delay(1000);
		await dc.threadsRequest();

		await waitAllThrowIfTerminates(dc,
			dc.waitForEvent("terminated"),
			dc.terminateRequest(),
		);
	});

	it("expected debugger services/extensions are available in debug mode", async () => {
		const config = await startDebugger(dc, flutterHelloWorldMainFile);
		await waitAllThrowIfTerminates(dc,
			dc.flutterAppStarted(),
			dc.configurationSequence(),
			dc.launch(config),
		);

		await waitForResult(() => privateApi.debugCommands.vmServices.serviceIsRegistered(VmService.HotReload) === true, "Hot reload registered");
		await waitForResult(() => privateApi.debugCommands.vmServices.serviceExtensionIsLoaded(VmServiceExtension.DebugPaint) === true, "Debug paint loaded");
		await waitForResult(() => privateApi.debugCommands.vmServices.serviceExtensionIsLoaded(VmServiceExtension.DebugBanner) === true, "Debug banner loaded");

		await waitAllThrowIfTerminates(dc,
			dc.waitForEvent("terminated"),
			dc.terminateRequest(),
		);

		await waitForResult(() => privateApi.debugCommands.vmServices.serviceIsRegistered(VmService.HotReload) === false, "Hot reload unregistered");
		await waitForResult(() => privateApi.debugCommands.vmServices.serviceExtensionIsLoaded(VmServiceExtension.DebugPaint) === false, "Debug paint unloaded");
		await waitForResult(() => privateApi.debugCommands.vmServices.serviceExtensionIsLoaded(VmServiceExtension.DebugBanner) === false, "Debug banner unloaded");
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

		await waitForResult(() => privateApi.debugCommands.vmServices.serviceIsRegistered(VmService.HotReload) === expectHotReload, "Hot reload registered");
		await waitForResult(() => privateApi.debugCommands.vmServices.serviceExtensionIsLoaded(VmServiceExtension.DebugPaint) === expectOtherServices, "Debug paint loaded");
		await waitForResult(() => privateApi.debugCommands.vmServices.serviceExtensionIsLoaded(VmServiceExtension.DebugBanner) === expectOtherServices, "Debug banner loaded");

		await waitAllThrowIfTerminates(dc,
			dc.waitForEvent("terminated"),
			dc.terminateRequest(),
		);

		await waitForResult(() => privateApi.debugCommands.vmServices.serviceIsRegistered(VmService.HotReload) === false, "Hot reload unregistered");
		await waitForResult(() => privateApi.debugCommands.vmServices.serviceExtensionIsLoaded(VmServiceExtension.DebugPaint) === false, "Debug paint unloaded");
		await waitForResult(() => privateApi.debugCommands.vmServices.serviceExtensionIsLoaded(VmServiceExtension.DebugBanner) === false, "Debug banner unloaded");
	});

	it("expected debugger services/extensions are available after a hot restart", async () => {
		const config = await startDebugger(dc, flutterHelloWorldMainFile);
		await waitAllThrowIfTerminates(dc,
			dc.flutterAppStarted(),
			dc.configurationSequence(),
			dc.launch(config),
		);

		await waitForResult(() => privateApi.debugCommands.vmServices.serviceIsRegistered(VmService.HotReload) === true, "Hot reload registered");
		await waitForResult(() => privateApi.debugCommands.vmServices.serviceExtensionIsLoaded(VmServiceExtension.DebugPaint) === true, "Debug paint loaded");
		await waitForResult(() => privateApi.debugCommands.vmServices.serviceExtensionIsLoaded(VmServiceExtension.DebugBanner) === true, "Debug banner loaded");

		await delayBeforeRestart();
		await waitAllThrowIfTerminates(dc,
			dc.assertOutputContains("stdout", "Restarted app"),
			vs.commands.executeCommand("flutter.hotRestart") as Promise<void>,
		);

		await waitForResult(() => privateApi.debugCommands.vmServices.serviceIsRegistered(VmService.HotReload) === true, "Hot reload registered 2");
		await waitForResult(() => privateApi.debugCommands.vmServices.serviceExtensionIsLoaded(VmServiceExtension.DebugPaint) === true, "Debug paint loaded 2");
		await waitForResult(() => privateApi.debugCommands.vmServices.serviceExtensionIsLoaded(VmServiceExtension.DebugBanner) === true, "Debug banner loaded 2");

		await waitAllThrowIfTerminates(dc,
			dc.waitForEvent("terminated"),
			dc.terminateRequest(),
		);

		await waitForResult(() => privateApi.debugCommands.vmServices.serviceIsRegistered(VmService.HotReload) === false, "Hot reload unregistered");
		await waitForResult(() => privateApi.debugCommands.vmServices.serviceExtensionIsLoaded(VmServiceExtension.DebugPaint) === false, "Debug paint unloaded");
		await waitForResult(() => privateApi.debugCommands.vmServices.serviceExtensionIsLoaded(VmServiceExtension.DebugBanner) === false, "Debug banner unloaded");
	});

	it("can quit during a build", async () => {
		const config = await startDebugger(dc, flutterHelloWorldMainFile);
		const configSequence = dc.configurationSequence();
		// Kick off a build, but do not await it...
		void dc.launch(config);

		// Wait 2 seconds after configuration sequence completes to ensure the build is in progress...
		await configSequence;
		await delay(2000);

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

	const numReloads = 1;
	it(`stops at a breakpoint after each reload (${numReloads})`, async function () {
		if (!dc.isDartDap && flutterTestDeviceIsWeb && (privateApi.flutterCapabilities?.version.startsWith("3.19") || privateApi.flutterCapabilities?.version.startsWith("3.20"))) {
			// This is known broken in Flutter 3.19+3.20 (for legacy DAP) so skip for this version and re-enable
			// for the next version.
			// https://github.com/dart-lang/sdk/issues/54925
			this.skip();
		}

		// Also broken in SDK DAP for web because of https://github.com/dart-lang/webdev/issues/1416
		if (flutterTestDeviceIsWeb)
			this.skip();

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
		dc.assertPath(frames[0].source!.path, expectedLocation.path);
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
						dc.assertPath(frames[0].source!.path, expectedLocation.path);
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
				.then(() => delay(1000))
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
				dc.assertPath(frame.source!.path, expectedPrintDefinitionPath);
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
		const httpReadCall = positionOf("http.^read(");
		const httpReadDef = await getDefinition(httpReadCall);
		const expectedHttpReadDefinitionPath = fsPath(uriFor(httpReadDef));
		const config = await startDebugger(dc, flutterHelloWorldHttpFile, { debugExternalPackageLibraries: true });
		await dc.hitBreakpoint(config, {
			column: httpReadCall.character + 1,
			line: httpReadCall.line + 1,
			path: fsPath(flutterHelloWorldHttpFile),
		});
		await waitAllThrowIfTerminates(dc,
			dc.assertStoppedLocation("step", {
				// Ensure we stepped into the external file
				path: expectedHttpReadDefinitionPath,
			}).then((response) => {
				// Ensure the top stack frame matches
				const frame = response.body.stackFrames[0];
				assert.equal(frame.name, "read");
				dc.assertPath(frame.source!.path, expectedHttpReadDefinitionPath);
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
		const expectedPrintThingDefinitionPath = fsPath(uriFor(printMyThingDef));
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
				path: expectedPrintThingDefinitionPath,
			}).then((response) => {
				// Ensure the top stack frame matches
				const frame = response.body.stackFrames[0];
				assert.equal(frame.name, "printMyThing");
				dc.assertPath(frame.source!.path, expectedPrintThingDefinitionPath);
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
			dc.waitForStop(),
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
			dc.waitForStop(),
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

	it("correctly marks non-debuggable external library frames when debugExternalPackageLibraries is false", async function () {
		if (!dc.isDartDap) // This fails because we think we stop on "pause interrupted", but since legacy DAP is going away we will just skip.
			this.skip();

		await openFile(flutterHelloWorldThrowInExternalPackageFile);
		const config = await startDebugger(dc, flutterHelloWorldThrowInExternalPackageFile, { debugExternalPackageLibraries: false });
		await waitAllThrowIfTerminates(dc,
			dc.waitForEvent("initialized")
				.then(() => dc.setExceptionBreakpointsRequest({ filters: ["All"] }))
				.then(() => dc.configurationDoneRequest()),
			dc.waitForStop(),
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
			dc.waitForStop(),
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
			dc.waitForStop(),
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

	function testBreakpointCondition(condition: string, shouldStop: boolean, expectedError?: string) {
		return async () => {
			await openFile(flutterHelloWorldMainFile);
			const config = await startDebugger(dc, flutterHelloWorldMainFile);

			let didStop = false;

			dc.waitForStop()
				.then(() => didStop = true)
				.catch(() => {
					// Swallow errors, as we don't care if this times out, we're only using it
					// to tell if we stopped by the time we hit the end of this test.
				});

			let expectation: Promise<any> = resolvedPromise;
			if (shouldStop)
				expectation = expectation.then(() => dc.waitForStop());

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
				.then(() => delay(2000))
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
						dc.assertPath(event.body.source!.path, fsPath(flutterHelloWorldBrokenFile));
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
		// Currently this test fails on Chrome because we always lose the race
		// with enabling structured errors versus the error occurring
		if (flutterTestDeviceIsWeb)
			return this.skip();

		await openFile(flutterHelloWorldBrokenFile);
		const config = await startDebugger(dc, flutterHelloWorldBrokenFile);

		// Collect all output.
		let allOutput = "";
		const handleOutput = (event: DebugProtocol.OutputEvent) => {
			// We might have trailing newlines on events, so when we split to add prefixes, we should not
			// add one to the end of the string.
			const endsWithNewline = event.body.output.endsWith("\n");
			allOutput += event.body.output.trimEnd().split("\n").map((l) => `${event.body.category}: ${l}`).join("\n");
			if (endsWithNewline)
				allOutput += "\n";
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
		const timingRegex = /\[[ \d]+\] /g;
		stdErrLines = stdErrLines.map((line) => line.replace(timingRegex, ""));

		const expectedErrorLines = dc.isDartDap && privateApi.flutterCapabilities.hasSdkDapWithStructuredErrors
			? [
				`stderr: ════════ Exception caught by widgets library ═══════════════════════════════════`,
				`stdout: The following _Exception was thrown building MyBrokenHomePage(dirty):`,
				`stderr: Exception: Oops`,
				`stdout:`,
				`stdout: The relevant error-causing widget was:`,
				`stdout:     MyBrokenHomePage MyBrokenHomePage:${flutterHelloWorldBrokenFile.toString(true)}:11:13`,
				`stdout:`,
				`stdout: When the exception was thrown, this was the stack:`,
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
