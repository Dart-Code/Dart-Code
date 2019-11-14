import * as assert from "assert";
import * as os from "os";
import * as path from "path";
import * as vs from "vscode";
import { DebugProtocol } from "vscode-debugprotocol";
import { FlutterService, FlutterServiceExtension } from "../../../shared/enums";
import { fetch } from "../../../shared/fetch";
import { grey, grey2 } from "../../../shared/utils/colors";
import { fsPath } from "../../../shared/vscode/utils";
import { DartDebugClient } from "../../dart_debug_client";
import { ensureFrameCategories, ensureMapEntry, ensureVariable, ensureVariableWithIndex, isExternalPackage, isLocalPackage, isSdkFrame, isUserCode, killFlutterTester } from "../../debug_helpers";
import { activate, defer, delay, ext, extApi, fileSafeCurrentTestName, flutterHelloWorldBrokenFile, flutterHelloWorldExampleSubFolder, flutterHelloWorldExampleSubFolderMainFile, flutterHelloWorldFolder, flutterHelloWorldGettersFile, flutterHelloWorldHttpFile, flutterHelloWorldLocalPackageFile, flutterHelloWorldMainFile, flutterHelloWorldThrowInExternalPackageFile, flutterHelloWorldThrowInLocalPackageFile, flutterHelloWorldThrowInSdkFile, getDefinition, getLaunchConfiguration, getPackages, makeTrivialChangeToFileDirectly, openFile, positionOf, saveTrivialChangeToFile, sb, setConfigForTest, waitForResult, watchPromise } from "../../helpers";

for (const deviceId of ["flutter-tester", "chrome"]) {
	const deviceName = deviceId === "chrome" ? "Chrome" : "Flutter test device";
	describe(`flutter run debugger (launch on ${deviceId})`, () => {
		// We have tests that require external packages.
		before("get packages", () => getPackages());
		beforeEach("activate flutterHelloWorldMainFile", () => activate(flutterHelloWorldMainFile));

		beforeEach("Skip if web device is not supported", function () {
			// TODO: Remove branch check when Flutter removes it.
			if (deviceId === "chrome" && process.env.ONLY_RUN_DART_VERSION === "STABLE")
				this.skip();
		});

		// We don't commit all the iOS/Android stuff to this repo to save space, but we can bring it back with
		// `flutter create .`!
		before("run 'flutter create'", () => vs.commands.executeCommand("_flutter.create", fsPath(flutterHelloWorldFolder)));
		before("run 'flutter create' for example", () => vs.commands.executeCommand("_flutter.create", fsPath(flutterHelloWorldExampleSubFolder)));
		before("run 'flutter clean'", () => vs.commands.executeCommand("_flutter.clean", fsPath(flutterHelloWorldFolder)));

		let dc: DartDebugClient;
		beforeEach("create debug client", () => {
			dc = new DartDebugClient(process.execPath, path.join(ext.extensionPath, "out/extension/debug/flutter_debug_entry.js"), "dart", undefined, extApi.debugCommands, undefined);
			dc.defaultTimeout = 60000;
			const thisDc = dc;
			defer(() => thisDc.stop());
		});

		afterEach(() => watchPromise("Killing flutter_tester processes", killFlutterTester()));

		async function startDebugger(script?: vs.Uri | string, extraConfiguration?: { [key: string]: any }): Promise<vs.DebugConfiguration> {
			extraConfiguration = Object.assign(
				{},
				{
					// Use pid-file as a convenient way of getting the test name into the command line args
					// for easier debugging of processes that hang around on CI (we dump the process command
					// line at the end of the test run).
					args: extApi.flutterCapabilities.supportsPidFileForMachine
						? ["--pid-file", path.join(os.tmpdir(), fileSafeCurrentTestName)]
						: [],
					deviceId,
				},
				extraConfiguration,
			);
			const config = await getLaunchConfiguration(script, extraConfiguration);
			if (!config)
				throw new Error(`Could not get launch configuration (got ${config})`);
			await watchPromise("startDebugger->start", dc.start(config.debugServer));
			return config;
		}

		it("runs and remains active until told to quit", async () => {
			const config = await startDebugger(flutterHelloWorldMainFile);
			await Promise.all([
				dc.assertOutputContains("stdout", `Launching lib${path.sep}main.dart on ${deviceName} in debug mode...\n`),
				dc.configurationSequence(),
				dc.launch(config),
			]);

			// Ensure we're still responsive after 3 seconds.
			await delay(3000);
			await dc.threadsRequest();

			await Promise.all([
				dc.waitForEvent("terminated"),
				dc.terminateRequest(),
			]);
		});

		describe("prompts the user if trying to run with errors", () => {
			it("and cancels launch if they click Show Errors");
			it("and launches if they click Debug Anyway");
			it("unless the errors are in test scripts");
			it("in the test script being run");
		});

		it("expected debugger services are available in debug mode", async () => {
			const config = await startDebugger(flutterHelloWorldMainFile);
			await Promise.all([
				dc.configurationSequence(),
				dc.launch(config),
			]);

			await waitForResult(() => extApi.debugCommands.flutterExtensions.serviceIsRegistered(FlutterService.HotRestart) === true);
			await waitForResult(() => extApi.debugCommands.flutterExtensions.serviceIsRegistered(FlutterService.HotReload) === true);

			await Promise.all([
				dc.waitForEvent("terminated"),
				dc.terminateRequest(),
			]);

			await waitForResult(() => extApi.debugCommands.flutterExtensions.serviceIsRegistered(FlutterService.HotRestart) === false);
			await waitForResult(() => extApi.debugCommands.flutterExtensions.serviceIsRegistered(FlutterService.HotReload) === false);
		});

		it("expected debugger services are available in noDebug mode", async () => {
			const config = await startDebugger(flutterHelloWorldMainFile);
			config.noDebug = true;
			await Promise.all([
				dc.configurationSequence(),
				dc.launch(config),
			]);

			await waitForResult(() => extApi.debugCommands.flutterExtensions.serviceIsRegistered(FlutterService.HotRestart) === true);
			await waitForResult(() => extApi.debugCommands.flutterExtensions.serviceIsRegistered(FlutterService.HotReload) === true);

			await Promise.all([
				dc.waitForEvent("terminated"),
				dc.terminateRequest(),
			]);

			await waitForResult(() => extApi.debugCommands.flutterExtensions.serviceIsRegistered(FlutterService.HotRestart) === false);
			await waitForResult(() => extApi.debugCommands.flutterExtensions.serviceIsRegistered(FlutterService.HotReload) === false);
		});

		it("expected debugger service extensions are available in debug mode", async () => {
			const config = await startDebugger(flutterHelloWorldMainFile);
			await Promise.all([
				dc.configurationSequence(),
				dc.launch(config),
			]);

			await waitForResult(() => extApi.debugCommands.flutterExtensions.serviceExtensionIsLoaded(FlutterServiceExtension.DebugPaint) === true);
			await waitForResult(() => extApi.debugCommands.flutterExtensions.serviceExtensionIsLoaded(FlutterServiceExtension.DebugBanner) === true);

			await Promise.all([
				dc.waitForEvent("terminated"),
				dc.terminateRequest(),
			]);

			await waitForResult(() => extApi.debugCommands.flutterExtensions.serviceExtensionIsLoaded(FlutterServiceExtension.DebugPaint) === false);
			await waitForResult(() => extApi.debugCommands.flutterExtensions.serviceExtensionIsLoaded(FlutterServiceExtension.DebugBanner) === false);
		});

		it("expected debugger service extensions are available in noDebug mode", async () => {
			const config = await startDebugger(flutterHelloWorldMainFile);
			config.noDebug = true;
			await Promise.all([
				dc.configurationSequence(),
				dc.launch(config),
			]);

			await waitForResult(() => extApi.debugCommands.flutterExtensions.serviceExtensionIsLoaded(FlutterServiceExtension.DebugPaint) === true);
			await waitForResult(() => extApi.debugCommands.flutterExtensions.serviceExtensionIsLoaded(FlutterServiceExtension.DebugBanner) === true);

			await Promise.all([
				dc.waitForEvent("terminated"),
				dc.terminateRequest(),
			]);

			await waitForResult(() => extApi.debugCommands.flutterExtensions.serviceExtensionIsLoaded(FlutterServiceExtension.DebugPaint) === false);
			await waitForResult(() => extApi.debugCommands.flutterExtensions.serviceExtensionIsLoaded(FlutterServiceExtension.DebugBanner) === false);
		});

		it("can quit during a build", async function () {
			if (deviceId === "chrome")
				return this.skip();

			const config = await startDebugger(flutterHelloWorldMainFile);
			// Kick off a build, but do not await it...
			Promise.all([
				dc.configurationSequence(),
				dc.launch(config),
			]);

			// Wait 5 seconds to ensure the build is in progress...
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

		it("receives the expected output", async function () {
			if (deviceId === "chrome")
				return this.skip();

			const config = await startDebugger(flutterHelloWorldMainFile);
			await Promise.all([
				dc.configurationSequence(),
				dc.assertOutputContains("stdout", "Hello, world!"),
				dc.assertOutputContains("console", "Logging from dart:developer!"),
				dc.launch(config),
			]);

			await Promise.all([
				dc.waitForEvent("terminated"),
				dc.terminateRequest(),
			]);
		});

		it("can run with a relative path in launch config", async () => {
			const config = await startDebugger(flutterHelloWorldMainFile);
			config.program = path.relative(fsPath(flutterHelloWorldFolder), fsPath(flutterHelloWorldMainFile));
			await Promise.all([
				dc.configurationSequence(),
				dc.launch(config),
			]);

			// Ensure we're still responsive after 3 seconds.
			await delay(3000);
			await dc.threadsRequest();

			await Promise.all([
				dc.waitForEvent("terminated"),
				dc.terminateRequest(),
			]);
		}).timeout(90000); // The 10 second delay makes this test slower and sometimes hit 60s.

		it("can run with a variable in cwd", async () => {
			const config = await startDebugger(flutterHelloWorldMainFile, { cwd: "${workspaceFolder}/" });
			config.program = path.relative(fsPath(flutterHelloWorldFolder), fsPath(flutterHelloWorldMainFile));
			await Promise.all([
				dc.configurationSequence(),
				dc.launch(config),
			]);

			// Ensure we're still responsive after 3 seconds.
			await delay(3000);
			await dc.threadsRequest();

			await Promise.all([
				dc.waitForEvent("terminated"),
				dc.terminateRequest(),
			]);
		});

		it("can hot reload", async function () {
			if (deviceId === "chrome")
				return this.skip();

			const config = await startDebugger(flutterHelloWorldMainFile);
			await Promise.all([
				watchPromise("hot_reloads_successfully->configurationSequence", dc.configurationSequence()),
				watchPromise("hot_reloads_successfully->launch", dc.launch(config)),
			]);

			await watchPromise("hot_reloads_successfully->hotReload", dc.hotReload());

			await Promise.all([
				watchPromise("hot_reloads_successfully->waitForEvent:terminated", dc.waitForEvent("terminated")),
				watchPromise("hot_reloads_successfully->terminateRequest", dc.terminateRequest()),
			]);
		});

		it("hot reloads on save", async () => {
			const config = await startDebugger(flutterHelloWorldMainFile);
			await Promise.all([
				dc.configurationSequence(),
				dc.launch(config),
			]);

			// If we go too fast, things fail..
			await delay(500);

			await Promise.all([
				dc.waitForHotReload(),
				saveTrivialChangeToFile(flutterHelloWorldMainFile),
			]);

			await Promise.all([
				dc.waitForEvent("terminated"),
				dc.terminateRequest(),
			]);
		});

		it("hot reloads on external modification of file", async () => {
			await setConfigForTest("dart", "previewHotReloadOnSaveWatcher", true);
			const config = await startDebugger(flutterHelloWorldMainFile);
			await Promise.all([
				dc.configurationSequence(),
				dc.launch(config),
			]);

			// If we go too fast, things fail..
			await delay(500);

			await Promise.all([
				dc.waitForHotReload(),
				makeTrivialChangeToFileDirectly(flutterHelloWorldMainFile),
			]);

			await Promise.all([
				dc.waitForEvent("terminated"),
				dc.terminateRequest(),
			]);
		});

		it("can hot restart", async () => {
			const config = await startDebugger(flutterHelloWorldMainFile);
			await Promise.all([
				dc.configurationSequence(),
				dc.launch(config),
			]);

			// If we restart too fast, things fail :-/
			await delay(1000);

			await Promise.all([
				dc.assertOutputContains("stdout", "Restarted app"),
				dc.customRequest("hotRestart"),
			]);

			await Promise.all([
				dc.waitForEvent("terminated"),
				dc.terminateRequest(),
			]);
		});

		it("can run projects in sub-folders when the open file is in a project sub-folder", async function () {
			if (deviceId === "chrome")
				return this.skip();

			await openFile(flutterHelloWorldExampleSubFolderMainFile);
			const config = await startDebugger();
			await Promise.all([
				dc.configurationSequence(),
				dc.launch(config),
			]);

			// If we restart too fast, things fail :-/
			await delay(1000);

			await Promise.all([
				dc.assertOutputContains("stdout", "This output is from an example sub-folder!"),
				dc.customRequest("hotRestart"),
			]);

			await Promise.all([
				dc.waitForEvent("terminated"),
				dc.terminateRequest(),
			]);
		});

		it("can run projects in sub-folders when cwd is set to a project sub-folder", async function () {
			if (deviceId === "chrome")
				return this.skip();

			const config = await startDebugger(undefined, { cwd: "example" });
			await Promise.all([
				dc.configurationSequence(),
				dc.launch(config),
			]);

			// If we restart too fast, things fail :-/
			await delay(1000);

			await Promise.all([
				dc.assertOutputContains("stdout", "This output is from an example sub-folder!"),
				dc.customRequest("hotRestart"),
			]);

			await Promise.all([
				dc.waitForEvent("terminated"),
				dc.terminateRequest(),
			]);
		});

		it("can launch DevTools", async function () {
			if (!extApi.flutterCapabilities.supportsDevTools)
				return this.skip();

			const openBrowserCommand = sb.stub(extApi.envUtils, "openInBrowser").resolves();

			const config = await startDebugger(flutterHelloWorldMainFile);
			await Promise.all([
				dc.assertOutputContains("stdout", `Launching lib${path.sep}main.dart on ${deviceName} in debug mode...\n`),
				dc.configurationSequence(),
				dc.launch(config),
			]);

			const devTools = await vs.commands.executeCommand("dart.openDevTools") as { url: string, dispose: () => void };
			assert.ok(openBrowserCommand.calledOnce);
			assert.ok(devTools);
			defer(devTools.dispose);
			assert.ok(devTools.url);

			const serverResponse = await fetch(devTools.url);
			assert.notEqual(serverResponse.indexOf("Dart DevTools"), -1);

			await Promise.all([
				dc.waitForEvent("terminated"),
				dc.terminateRequest(),
			]);
		});

		[0, 1, 2].forEach((numReloads) => {
			const reloadDescription =
				numReloads === 0
					? ""
					: ` after ${numReloads} reload${numReloads === 1 ? "" : "s"}`;

			it("stops at a breakpoint" + reloadDescription, async function () {
				if (numReloads && extApi.flutterCapabilities.hasEvictBug)
					return this.skip();

				await openFile(flutterHelloWorldMainFile);
				const config = await startDebugger(flutterHelloWorldMainFile);
				const expectedLocation = {
					line: positionOf("^// BREAKPOINT1").line, // positionOf is 0-based, and seems to want 1-based, BUT comment is on next line!
					path: fsPath(flutterHelloWorldMainFile),
				};
				await watchPromise("stops_at_a_breakpoint->hitBreakpoint", dc.hitBreakpoint(config, expectedLocation));
				const stack = await dc.getStack();
				const frames = stack.body.stackFrames;
				// Web/Flutter have slightly different representations of this
				// so allow either.
				if (frames[0].name.indexOf(".") !== -1)
					assert.equal(frames[0].name, "MyHomePage.build");
				else
					assert.equal(frames[0].name, "build");
				assert.equal(frames[0].source!.path, expectedLocation.path);
				assert.equal(frames[0].source!.name, "package:hello_world/main.dart");

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
					await Promise.all([
						watchPromise(`stops_at_a_breakpoint->reload:${i}->assertStoppedLocation:breakpoint`, dc.assertStoppedLocation("breakpoint", expectedLocation))
							.then(async (_) => {
								const stack = await watchPromise(`stops_at_a_breakpoint->reload:${i}->getStack`, dc.getStack());
								const frames = stack.body.stackFrames;
								// Web/Flutter have slightly different representations of this
								// so allow either.
								if (frames[0].name.indexOf(".") !== -1)
									assert.equal(frames[0].name, "MyHomePage.build");
								else
									assert.equal(frames[0].name, "build");
								assert.equal(frames[0].source!.path, expectedLocation.path);
								assert.equal(frames[0].source!.name, "package:hello_world/main.dart");
							})
							.then((_) => watchPromise(`stops_at_a_breakpoint->reload:${i}->resume`, dc.resume())),
						watchPromise(`stops_at_a_breakpoint->reload:${i}->hotReload:breakpoint`, dc.hotReload()),
					]);
				}

				await Promise.all([
					dc.waitForEvent("terminated"),
					dc.terminateRequest(),
				]);
			});
		});

		it("does not stop at a breakpoint in noDebug mode", async () => {
			await openFile(flutterHelloWorldMainFile);
			const config = await startDebugger(flutterHelloWorldMainFile);
			config.noDebug = true;

			let didStop = false;
			dc.waitForEvent("stopped").then(() => didStop = true);
			await Promise.all([
				dc.waitForEvent("terminated"),
				dc.setBreakpointWithoutHitting(config, {
					line: positionOf("^// BREAKPOINT1").line + 1, // positionOf is 0-based, but seems to want 1-based
					path: fsPath(flutterHelloWorldMainFile),
					verified: false,
				})
					.then(() => delay(2000))
					.then(() => dc.terminateRequest()),
			]);

			assert.equal(didStop, false);
		});

		it("stops at a breakpoint in a part file");

		it("stops at a breakpoint in a deferred file");

		// Known not to work; https://github.com/Dart-Code/Dart-Code/issues/821
		it.skip("stops at a breakpoint in the SDK");

		it("stops at a breakpoint in an external package");

		it("steps into the SDK if debugSdkLibraries is true", async function () {
			if (deviceId === "chrome")
				return this.skip();

			await openFile(flutterHelloWorldMainFile);
			// Get location for `print`
			const printCall = positionOf("pri^nt(");
			const config = await startDebugger(flutterHelloWorldMainFile, { debugSdkLibraries: true });
			await dc.hitBreakpoint(config, {
				line: printCall.line + 1,
				path: fsPath(flutterHelloWorldMainFile),
			});
			await Promise.all([
				dc.assertStoppedLocation("step", {
					// SDK source will have no filename, because we download it
					path: undefined,
				}).then((response) => {
					// Ensure the top stack frame matches
					const frame = response.body.stackFrames[0];
					assert.equal(frame.name, "print");
					// We don't get a source path, because the source is downloaded from the VM
					assert.equal(frame.source!.path, undefined);
					assert.equal(frame.source!.name, "dart:core/print.dart");
				}),
				dc.stepIn(),
			]);

			await Promise.all([
				dc.waitForEvent("terminated"),
				dc.terminateRequest(),
			]);
		});

		it("does not step into the SDK if debugSdkLibraries is false", async function () {
			if (deviceId === "chrome")
				return this.skip();

			await openFile(flutterHelloWorldMainFile);
			// Get location for `print`
			const printCall = positionOf("pri^nt(");
			const config = await startDebugger(flutterHelloWorldMainFile, { debugSdkLibraries: false });
			await dc.hitBreakpoint(config, {
				line: printCall.line + 1,
				path: fsPath(flutterHelloWorldMainFile),
			});
			await Promise.all([
				dc.assertStoppedLocation("step", {
					// Ensure we stayed in the current file
					path: fsPath(flutterHelloWorldMainFile),
				}),
				dc.stepIn(),
			]);

			await Promise.all([
				dc.waitForEvent("terminated"),
				dc.terminateRequest(),
			]);
		});

		it("steps into an external library if debugExternalLibraries is true", async function () {
			if (deviceId === "chrome")
				return this.skip();

			await openFile(flutterHelloWorldHttpFile);
			// Get location for `http.read(`
			const httpReadCall = positionOf("http.re^ad(");
			const httpReadDef = await getDefinition(httpReadCall);
			const config = await startDebugger(flutterHelloWorldHttpFile, { debugExternalLibraries: true });
			await dc.hitBreakpoint(config, {
				line: httpReadCall.line + 1,
				path: fsPath(flutterHelloWorldHttpFile),
			});
			await Promise.all([
				dc.assertStoppedLocation("step", {
					// Ensure we stepped into the external file
					path: fsPath(httpReadDef.uri),
				}).then((response) => {
					// Ensure the top stack frame matches
					const frame = response.body.stackFrames[0];
					assert.equal(frame.name, "read");
					assert.equal(frame.source!.path, fsPath(httpReadDef.uri));
					assert.equal(frame.source!.name, "package:http/http.dart");
				}),
				dc.stepIn(),
			]);

			await Promise.all([
				dc.waitForEvent("terminated"),
				dc.terminateRequest(),
			]);
		});

		it("does not step into an external library if debugExternalLibraries is false", async function () {
			if (deviceId === "chrome")
				return this.skip();

			await openFile(flutterHelloWorldHttpFile);
			// Get location for `http.read(`
			const httpReadCall = positionOf("http.re^ad(");
			const config = await startDebugger(flutterHelloWorldHttpFile, { debugExternalLibraries: false });
			await dc.hitBreakpoint(config, {
				line: httpReadCall.line,
				path: fsPath(flutterHelloWorldHttpFile),
			});
			await Promise.all([
				dc.assertStoppedLocation("step", {
					// Ensure we stayed in the current file
					path: fsPath(flutterHelloWorldHttpFile),
				}),
				dc.stepIn(),
			]);

			await Promise.all([
				dc.waitForEvent("terminated"),
				dc.terminateRequest(),
			]);
		});

		it("steps into a local library even if debugExternalLibraries is false", async function () {
			if (deviceId === "chrome")
				return this.skip();

			await openFile(flutterHelloWorldLocalPackageFile);
			// Get location for `printMyThing()`
			const printMyThingCall = positionOf("printMy^Thing(");
			const printMyThingDef = await getDefinition(printMyThingCall);
			const config = await startDebugger(flutterHelloWorldLocalPackageFile, { debugExternalLibraries: false });
			await dc.hitBreakpoint(config, {
				line: printMyThingCall.line + 1,
				path: fsPath(flutterHelloWorldLocalPackageFile),
			});
			await Promise.all([
				dc.assertStoppedLocation("step", {
					// Ensure we stepped into the external file
					path: fsPath(printMyThingDef.uri),
				}).then((response) => {
					// Ensure the top stack frame matches
					const frame = response.body.stackFrames[0];
					assert.equal(frame.name, "printMyThing");
					assert.equal(frame.source!.path, fsPath(printMyThingDef.uri));
					assert.equal(frame.source!.name, "package:my_package/my_thing.dart");
				}),
				dc.stepIn(),
			]);

			await Promise.all([
				dc.waitForEvent("terminated"),
				dc.terminateRequest(),
			]);
		});

		it("downloads SDK source code from the VM");

		it("correctly marks non-debuggable SDK frames when debugSdkLibraries is false", async function () {
			if (deviceId === "chrome")
				return this.skip();

			await openFile(flutterHelloWorldThrowInSdkFile);
			const config = await startDebugger(flutterHelloWorldThrowInSdkFile, { debugSdkLibraries: false });
			await Promise.all([
				dc.waitForEvent("initialized")
					.then(() => dc.setExceptionBreakpointsRequest({ filters: ["All"] }))
					.then(() => dc.configurationDoneRequest()),
				dc.waitForEvent("stopped"),
				dc.launch(config),
			]);
			const stack = await dc.getStack();
			ensureFrameCategories(stack.body.stackFrames.filter(isSdkFrame), "deemphasize", "from the Dart SDK");
			ensureFrameCategories(stack.body.stackFrames.filter(isUserCode), undefined, undefined);

			await Promise.all([
				dc.waitForEvent("terminated"),
				dc.terminateRequest(),
			]);
		});

		it("correctly marks debuggable SDK frames when debugSdkLibraries is true", async function () {
			if (deviceId === "chrome")
				return this.skip();

			await openFile(flutterHelloWorldThrowInSdkFile);
			const config = await startDebugger(flutterHelloWorldThrowInSdkFile, { debugSdkLibraries: true });
			await Promise.all([
				dc.waitForEvent("initialized")
					.then(() => dc.setExceptionBreakpointsRequest({ filters: ["All"] }))
					.then(() => dc.configurationDoneRequest()),
				dc.waitForEvent("stopped"),
				dc.launch(config),
			]);
			const stack = await dc.getStack();
			ensureFrameCategories(stack.body.stackFrames.filter(isSdkFrame), undefined, undefined);
			ensureFrameCategories(stack.body.stackFrames.filter(isUserCode), undefined, undefined);

			await Promise.all([
				dc.waitForEvent("terminated"),
				dc.terminateRequest(),
			]);
		});

		it("correctly marks non-debuggable external library frames when debugExternalLibraries is false", async function () {
			if (deviceId === "chrome")
				return this.skip();

			await openFile(flutterHelloWorldThrowInExternalPackageFile);
			const config = await startDebugger(flutterHelloWorldThrowInExternalPackageFile, { debugExternalLibraries: false });
			await Promise.all([
				dc.waitForEvent("initialized")
					.then(() => dc.setExceptionBreakpointsRequest({ filters: ["All"] }))
					.then(() => dc.configurationDoneRequest()),
				dc.waitForEvent("stopped"),
				dc.launch(config),
			]);
			const stack = await dc.getStack();
			ensureFrameCategories(stack.body.stackFrames.filter(isExternalPackage), "deemphasize", "from Pub packages");
			ensureFrameCategories(stack.body.stackFrames.filter(isUserCode), undefined, undefined);

			await Promise.all([
				dc.waitForEvent("terminated"),
				dc.terminateRequest(),
			]);
		});

		it("correctly marks debuggable external library frames when debugExternalLibraries is true", async function () {
			if (deviceId === "chrome")
				return this.skip();

			await openFile(flutterHelloWorldThrowInExternalPackageFile);
			const config = await startDebugger(flutterHelloWorldThrowInExternalPackageFile, { debugExternalLibraries: true });
			await Promise.all([
				dc.waitForEvent("initialized")
					.then(() => dc.setExceptionBreakpointsRequest({ filters: ["All"] }))
					.then(() => dc.configurationDoneRequest()),
				dc.waitForEvent("stopped"),
				dc.launch(config),
			]);
			const stack = await dc.getStack();
			ensureFrameCategories(stack.body.stackFrames.filter(isExternalPackage), undefined, undefined);
			ensureFrameCategories(stack.body.stackFrames.filter(isUserCode), undefined, undefined);

			await Promise.all([
				dc.waitForEvent("terminated"),
				dc.terminateRequest(),
			]);
		});

		it("correctly marks debuggable local library frames even when debugExternalLibraries is false", async function () {
			if (deviceId === "chrome")
				return this.skip();

			await openFile(flutterHelloWorldThrowInLocalPackageFile);
			const config = await startDebugger(flutterHelloWorldThrowInLocalPackageFile, { debugExternalLibraries: false });
			await Promise.all([
				dc.waitForEvent("initialized")
					.then(() => dc.setExceptionBreakpointsRequest({ filters: ["All"] }))
					.then(() => dc.configurationDoneRequest()),
				dc.waitForEvent("stopped"),
				dc.launch(config),
			]);
			const stack = await dc.getStack();
			ensureFrameCategories(stack.body.stackFrames.filter(isLocalPackage), undefined, undefined);
			ensureFrameCategories(stack.body.stackFrames.filter(isUserCode), undefined, undefined);

			await Promise.all([
				dc.waitForEvent("terminated"),
				dc.terminateRequest(),
			]);
		});

		function testBreakpointCondition(condition: string, shouldStop: boolean, expectedError?: string) {
			return async function (this: Mocha.Context) {
				if (deviceId === "chrome")
					return this.skip();

				await openFile(flutterHelloWorldMainFile);
				const config = await startDebugger(flutterHelloWorldMainFile);

				const completionEvent: Promise<any> =
					shouldStop
						? dc.assertStoppedLocation("breakpoint", {})
							.then(() => dc.waitForEvent("terminated"))
						: dc.waitForEvent("terminated");
				const errorOutputEvent: Promise<any> =
					expectedError
						? dc.assertOutputContains("console", expectedError)
						: Promise.resolve();

				await Promise.all([
					dc.waitForEvent("initialized").then((_) => dc.setBreakpointsRequest({
						// positionOf is 0-based, but seems to want 1-based
						breakpoints: [{
							condition,
							line: positionOf("^// BREAKPOINT1").line,
						}],
						source: { path: fsPath(flutterHelloWorldMainFile) },
					}))
						.then(() => dc.configurationDoneRequest())
						.then(() => delay(2000))
						.then(() => dc.terminateRequest()),
					completionEvent,
					errorOutputEvent,
					dc.launch(config),
				]);
			};
		}

		it("stops at a breakpoint with a condition returning true", testBreakpointCondition("1 == 1", true));
		it("stops at a breakpoint with a condition returning 1", testBreakpointCondition("3 - 2", true));
		it("does not stop at a breakpoint with a condition returning a string", testBreakpointCondition("'test'", false));
		it("does not stop at a breakpoint with a condition returning false", testBreakpointCondition("1 == 0", false));
		it("does not stop at a breakpoint with a condition returning 0", testBreakpointCondition("3 - 3", false));
		it("does not stop at a breakpoint with a condition returning null", testBreakpointCondition("print('test');", false));
		it("reports errors evaluating breakpoint conditions", testBreakpointCondition("1 + '1'", false, "Debugger failed to evaluate expression `1 + '1'`"));

		it("logs expected text (and does not stop) at a logpoint", async function () {
			if (deviceId === "chrome")
				return this.skip();

			await openFile(flutterHelloWorldMainFile);
			const config = await startDebugger(flutterHelloWorldMainFile);

			await Promise.all([
				dc.waitForEvent("initialized").then((_) => dc.setBreakpointsRequest({
					breakpoints: [{
						line: positionOf("^// BREAKPOINT1").line,
						// VS Code says to use {} for expressions, but we want to support Dart's native too, so
						// we have examples of both (as well as "escaped" brackets).
						logMessage: '${s} The \\{year} is """{(new DateTime.now()).year}"""',
					}],
					source: { path: fsPath(flutterHelloWorldMainFile) },
				}))
					.then(() => dc.configurationDoneRequest())
					.then(() => delay(5000))
					.then(() => dc.terminateRequest()),
				dc.waitForEvent("terminated"),
				dc.assertOutputContains("stdout", `Hello! The {year} is """${(new Date()).getFullYear()}"""\n`),
				dc.launch(config),
			]);
		});

		it("provides local variables when stopped at a breakpoint", async () => {
			await setConfigForTest("dart", "previewToStringInDebugViews", true);
			await openFile(flutterHelloWorldMainFile);
			const debugConfig = await startDebugger(flutterHelloWorldMainFile);
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
			if (deviceId !== "chrome") {
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

			const longdateListVariables = await dc.getVariables(variables.find((v) => v.name === "hundredDates")!.variablesReference);
			ensureVariable(longdateListVariables, "hundredDates[0]", "[0]", "DateTime"); // This doesn't call toString() because it's a long list'.

			const mapVariables = await dc.getVariables(variables.find((v) => v.name === "m")!.variablesReference);
			ensureVariable(mapVariables, undefined, "0", `"l" -> List (12 items)`);
			ensureVariable(mapVariables, undefined, "1", `"longStrings" -> List (1 item)`);
			ensureVariable(mapVariables, undefined, "2", `"tenDates" -> List (10 items)`);
			ensureVariable(mapVariables, undefined, "3", `"hundredDates" -> List (100 items)`);
			ensureVariable(mapVariables, undefined, "4", `"s" -> "Hello!"`);
			ensureVariable(mapVariables, undefined, "5", `DateTime -> "valentines-2000"`);
			ensureVariable(mapVariables, undefined, "6", `DateTime -> "new-year-2005"`);
			// TODO: Remove this condition when web supports these
			// https://github.com/dart-lang/webdev/issues/789
			if (deviceId !== "chrome") {
				ensureVariable(mapVariables, undefined, "7", `true -> true`);
				ensureVariable(mapVariables, undefined, "8", `1 -> "one"`);
				ensureVariable(mapVariables, undefined, "9", `1.1 -> "one-point-one"`);
			} else {
				console.warn(`Skipping bool/num check for Chrome...`);
			}

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
			// TODO: Remove this condition when web supports these
			// https://github.com/dart-lang/webdev/issues/789
			if (deviceId !== "chrome") {
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
			} else {
				console.warn(`Skipping bool/num check for Chrome...`);
			}

			await Promise.all([
				dc.waitForEvent("terminated"),
				dc.terminateRequest(),
			]);
		});

		it("excludes type args from local variables when stopped at a breakpoint in a generic method", async function () {
			if (deviceId === "chrome")
				return this.skip();

			await openFile(flutterHelloWorldMainFile);
			const debugConfig = await startDebugger(flutterHelloWorldMainFile);
			await dc.hitBreakpoint(debugConfig, {
				line: positionOf("^// BREAKPOINT2").line, // positionOf is 0-based, but seems to want 1-based
				path: fsPath(flutterHelloWorldMainFile),
			});

			const variables = await dc.getTopFrameVariables("Locals");
			ensureVariable(variables, "a", "a", `1`);
			// Ensure there were no others.
			assert.equal(variables.length, 1);

			await Promise.all([
				dc.waitForEvent("terminated"),
				dc.terminateRequest(),
			]);
		});

		it("includes getters in variables when stopped at a breakpoint", async function () {
			if (deviceId === "chrome")
				return this.skip();

			await openFile(flutterHelloWorldGettersFile);
			const config = await startDebugger(flutterHelloWorldGettersFile);
			await dc.hitBreakpoint(config, {
				line: positionOf("^// BREAKPOINT1").line + 1, // positionOf is 0-based, but seems to want 1-based
				path: fsPath(flutterHelloWorldGettersFile),
			});

			const variables = await dc.getTopFrameVariables("Locals");
			ensureVariable(variables, "danny", "danny", `Danny`);

			const classInstance = await dc.getVariables(variables.find((v) => v.name === "danny")!.variablesReference);
			ensureVariable(classInstance, "danny.kind", "kind", `"Person"`);
			ensureVariable(classInstance, "danny.name", "name", `"Danny"`);
			ensureVariable(classInstance, undefined, "throws", { starts: "Unhandled exception:\nOops!" });

			await Promise.all([
				dc.waitForEvent("terminated"),
				dc.terminateRequest(),
			]);
		});

		// Currently skipped because we sometimes get different text from locals, eg.:
		// "StatelessElement" vs "StatelessElement (MyHomepage(dirty))" 🤔
		it.skip("watch expressions provide same info as locals", async function () {
			if (deviceId === "chrome")
				return this.skip();

			await openFile(flutterHelloWorldMainFile);
			const config = await startDebugger(flutterHelloWorldMainFile);
			await dc.hitBreakpoint(config, {
				line: positionOf("^// BREAKPOINT1").line,
				path: fsPath(flutterHelloWorldMainFile),
			});

			const variables = await dc.getTopFrameVariables("Locals");

			for (const variable of variables) {
				const evaluateName = (variable as any).evaluateName;
				if (!evaluateName)
					continue;
				const evaluateResult = await dc.evaluate(evaluateName);
				assert.ok(evaluateResult);
				assert.equal(evaluateResult.result, variable.value);
				assert.equal(!!evaluateResult.variablesReference, !!variable.variablesReference);
			}

			await Promise.all([
				dc.waitForEvent("terminated"),
				dc.terminateRequest(),
			]);
		});

		it("evaluateName evaluates to the expected value", async function () {
			if (deviceId === "chrome")
				return this.skip();

			await openFile(flutterHelloWorldMainFile);
			const config = await startDebugger(flutterHelloWorldMainFile);
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
				const evaluateName = (variable as any).evaluateName;
				if (!evaluateName)
					continue;
				const evaluateResult = await dc.evaluate(evaluateName);
				assert.ok(evaluateResult);
				if (variable.value.endsWith("…\"")) {
					// If the value was truncated, the evaluate responses should be longer
					const prefix = variable.value.slice(1, -2);
					assert.ok(evaluateResult.result.length > prefix.length);
					assert.equal(evaluateResult.result.slice(0, prefix.length), prefix);
				} else {
					// Otherwise it should be the same.
					assert.equal(evaluateResult.result, variable.value);
				}
				assert.equal(!!evaluateResult.variablesReference, !!variable.variablesReference);
			}

			await Promise.all([
				dc.waitForEvent("terminated"),
				dc.terminateRequest(),
			]);
		});

		describe("can evaluate at breakpoint", function () {
			this.beforeEach(function () {
				if (deviceId === "chrome")
					this.skip();
			});

			it("simple expressions", async () => {
				await openFile(flutterHelloWorldMainFile);
				const config = await startDebugger(flutterHelloWorldMainFile);
				await Promise.all([
					dc.hitBreakpoint(config, {
						line: positionOf("^// BREAKPOINT1").line,
						path: fsPath(flutterHelloWorldMainFile),
					}),
				]);

				const evaluateResult = await dc.evaluate(`"test"`);
				assert.ok(evaluateResult);
				assert.equal(evaluateResult.result, `"test"`);
				assert.equal(evaluateResult.variablesReference, 0);

				await Promise.all([
					dc.waitForEvent("terminated"),
					dc.terminateRequest(),
				]);
			});

			it("complex expression expressions", async () => {
				await openFile(flutterHelloWorldMainFile);
				const config = await startDebugger(flutterHelloWorldMainFile);
				await Promise.all([
					dc.hitBreakpoint(config, {
						line: positionOf("^// BREAKPOINT1").line,
						path: fsPath(flutterHelloWorldMainFile),
					}),
				]);

				const evaluateResult = await dc.evaluate(`(new DateTime.now()).year`);
				assert.ok(evaluateResult);
				assert.equal(evaluateResult.result, (new Date()).getFullYear());
				assert.equal(evaluateResult.variablesReference, 0);

				await Promise.all([
					dc.waitForEvent("terminated"),
					dc.terminateRequest(),
				]);
			});

			it("an expression that returns a variable", async () => {
				await openFile(flutterHelloWorldMainFile);
				const config = await startDebugger(flutterHelloWorldMainFile);
				await Promise.all([
					dc.hitBreakpoint(config, {
						line: positionOf("^// BREAKPOINT1").line,
						path: fsPath(flutterHelloWorldMainFile),
					}),
				]);

				const evaluateResult = await dc.evaluate(`new DateTime.now()`);
				const thisYear = new Date().getFullYear().toString();
				assert.ok(evaluateResult);
				assert.ok(evaluateResult.result.startsWith("DateTime (" + thisYear), `Result '${evaluateResult.result}' did not start with ${thisYear}`);
				assert.ok(evaluateResult.variablesReference);

				await Promise.all([
					dc.waitForEvent("terminated"),
					dc.terminateRequest(),
				]);
			});

			it("complex expression expressions when in a top level function", async () => {
				await openFile(flutterHelloWorldMainFile);
				const config = await startDebugger(flutterHelloWorldMainFile);
				await Promise.all([
					dc.hitBreakpoint(config, {
						line: positionOf("^// BREAKPOINT2").line,
						path: fsPath(flutterHelloWorldMainFile),
					}),
				]);

				const evaluateResult = await dc.evaluate(`(new DateTime.now()).year`);
				assert.ok(evaluateResult);
				assert.equal(evaluateResult.result, (new Date()).getFullYear());
				assert.equal(evaluateResult.variablesReference, 0);

				await Promise.all([
					dc.waitForEvent("terminated"),
					dc.terminateRequest(),
				]);
			});
		});

		// Skipped due to https://github.com/flutter/flutter/issues/17007.
		it.skip("stops on exception", async () => {
			await openFile(flutterHelloWorldBrokenFile);
			const config = await startDebugger(flutterHelloWorldBrokenFile);
			await Promise.all([
				dc.configurationSequence(),
				dc.assertStoppedLocation("exception", {
					line: positionOf("^Oops").line + 1, // positionOf is 0-based, but seems to want 1-based
					path: fsPath(flutterHelloWorldBrokenFile),
				}),
				dc.launch(config),
			]);

			await Promise.all([
				dc.waitForEvent("terminated"),
				dc.terminateRequest(),
			]);
		});

		it("does not stop on exception in noDebug mode", async () => {
			await openFile(flutterHelloWorldBrokenFile);
			const config = await startDebugger(flutterHelloWorldBrokenFile);
			config.noDebug = true;

			let didStop = false;
			dc.waitForEvent("stopped").then(() => didStop = true);
			await Promise.all([
				dc.configurationSequence()
					.then(() => delay(2000))
					.then(() => dc.terminateRequest()),
				dc.waitForEvent("terminated"),
				dc.launch(config),
			]);

			assert.equal(didStop, false);
		});

		// Skipped due to https://github.com/flutter/flutter/issues/17007.
		it.skip("provides exception details when stopped on exception", async () => {
			await openFile(flutterHelloWorldBrokenFile);
			const config = await startDebugger(flutterHelloWorldBrokenFile);
			await Promise.all([
				dc.configurationSequence(),
				dc.assertStoppedLocation("exception", {
					line: positionOf("^won't find this").line + 1, // positionOf is 0-based, but seems to want 1-based
					path: fsPath(flutterHelloWorldBrokenFile),
				}),
				dc.launch(config),
			]);

			const variables = await dc.getTopFrameVariables("Exception");
			ensureVariable(variables, "$e.message", "message", `"(TODO WHEN UNSKIPPING)"`);

			await Promise.all([
				dc.waitForEvent("terminated"),
				dc.terminateRequest(),
			]);
		});

		it("writes exception to stderr", async () => {
			await openFile(flutterHelloWorldBrokenFile);
			const config = await startDebugger(flutterHelloWorldBrokenFile);
			await Promise.all([
				watchPromise("writes_failure_output->configurationSequence", dc.configurationSequence()),
				watchPromise("writes_failure_output->assertOutputContains", dc.assertOutputContains("stderr", "Exception: Oops\n")),
				watchPromise("writes_failure_output->launch", dc.launch(config)),
			]);

			await Promise.all([
				dc.waitForEvent("terminated"),
				dc.terminateRequest(),
			]);
		});

		it("moves known files from call stacks to metadata", async () => {
			await openFile(flutterHelloWorldBrokenFile);
			const config = await startDebugger(flutterHelloWorldBrokenFile);
			await Promise.all([
				watchPromise("writes_failure_output->configurationSequence", dc.configurationSequence()),
				watchPromise(
					"writes_failure_output->assertOutputContains",
					dc.assertOutputContains("stderr", "_throwAnException")
						.then((event) => {
							assert.equal(event.body.output.indexOf("package:hello_world/broken.dart"), -1);
							assert.equal(event.body.source!.name, "package:hello_world/broken.dart");
							assert.equal(event.body.source!.path, fsPath(flutterHelloWorldBrokenFile));
							assert.equal(event.body.line, positionOf("^Oops").line + 1); // positionOf is 0-based, but seems to want 1-based
							assert.equal(event.body.column, 5);
						}),
				),
				watchPromise("writes_failure_output->launch", dc.launch(config)),
			]);

			await Promise.all([
				dc.waitForEvent("terminated"),
				dc.terminateRequest(),
			]);
		});

		it("renders correct output for structured errors", async function () {
			if (!extApi.flutterCapabilities.hasUpdatedStructuredErrorsFormat)
				return this.skip();

			// Currently this test fails on Chrome because we always lose the race
			// with enabling structured errors versus the error occurring
			if (deviceId === "chrome")
				return this.skip();

			await openFile(flutterHelloWorldBrokenFile);
			const config = await startDebugger(flutterHelloWorldBrokenFile);

			await Promise.all([
				dc.configurationSequence(),
				dc.launch(config),
			]);

			await waitForResult(() => extApi.debugCommands.flutterExtensions.serviceExtensionIsLoaded(FlutterServiceExtension.InspectorStructuredErrors) === true);

			// Allow the initial error to be printed before we start collecting stderr.
			await delay(500);

			// Collect all output to stderr.
			let stderrOutput = "";
			const handleOutput = (event: DebugProtocol.OutputEvent) => {
				if (event.body.category === "stderr") {
					stderrOutput += event.body.output;
				}
			};
			dc.on("output", handleOutput);

			try {
				await dc.hotReload();
				await waitForResult(
					() => stderrOutput.toLowerCase().indexOf("exception caught by widgets library") !== -1
						&& stderrOutput.indexOf("════════════════════════════════════════════════════════════════════════════════") !== -1,
					"Waiting for error output",
					5000,
				);
			} finally {
				dc.removeListener("output", handleOutput);
			}

			await Promise.all([
				dc.waitForEvent("terminated"),
				dc.terminateRequest(),
			]);

			// Grab online the lines that form our error.
			let stdErrLines = stderrOutput.split("\n").map((l) => l.trim());
			// Trim off stuff before our error.
			const firstErrorLine = stdErrLines.findIndex((l) => l.toLowerCase().indexOf("exception caught by widgets library") !== -1);
			stdErrLines = stdErrLines.slice(firstErrorLine);
			// Trim off stuff after our error.
			const lastErrorLine = stdErrLines.findIndex((l) => l.indexOf("════════════════════════════════════════════════════════════════════════════════") !== -1);
			stdErrLines = stdErrLines.slice(0, lastErrorLine + 1);

			// Handle old/new error messages for stable/dev.
			const expectedErrorLines = stdErrLines.find((l) => l.indexOf("The relevant error-causing widget was") !== -1)
				? [
					grey2(`════════ Exception caught by widgets library ═══════════════════════════════════`),
					grey(`The following _Exception was thrown building MyBrokenHomePage(dirty):`),
					`Exception: Oops`,
					grey(`The relevant error-causing widget was`),
					grey2(`MyBrokenHomePage`),
					grey(`When the exception was thrown, this was the stack`),
					grey2(`#0      MyBrokenHomePage._throwAnException`),
					grey2(`#1      MyBrokenHomePage.build`),
					grey(`#2      StatelessElement.build`),
					grey(`#3      ComponentElement.performRebuild`),
					grey(`#4      Element.rebuild`),
					grey(`...`),
					grey2(`════════════════════════════════════════════════════════════════════════════════`),
				]
				: [
					grey2(`════════ Exception caught by widgets library ═══════════════════════════════════`),
					grey(`The following _Exception was thrown building MyBrokenHomePage(dirty):`),
					`Exception: Oops`,
					grey(`User-created ancestor of the error-causing widget was`),
					grey2(`MaterialApp`),
					grey(`When the exception was thrown, this was the stack`),
					grey2(`#0      MyBrokenHomePage._throwAnException`),
					grey2(`#1      MyBrokenHomePage.build`),
					grey(`#2      StatelessElement.build`),
					grey(`#3      ComponentElement.performRebuild`),
					grey(`#4      Element.rebuild`),
					grey(`...`),
					grey2(`════════════════════════════════════════════════════════════════════════════════`),
				];

			assert.deepStrictEqual(stdErrLines.map((s) => s.toLowerCase()), expectedErrorLines.map((s) => s.toLowerCase()));
		});
	});
}
