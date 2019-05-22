import * as assert from "assert";
import * as path from "path";
import * as vs from "vscode";
import { fsPath } from "../../../extension/utils";
import { fetch } from "../../../extension/utils/fetch";
import { FlutterService, FlutterServiceExtension } from "../../../shared/enums";
import { DartDebugClient } from "../../dart_debug_client";
import { ensureVariable, killFlutterTester } from "../../debug_helpers";
import { activate, defer, delay, ext, extApi, flutterWebBrokenMainFile, flutterWebHelloWorldExampleSubFolderMainFile, flutterWebHelloWorldFolder, flutterWebHelloWorldMainFile, getLaunchConfiguration, getPackages, openFile, positionOf, waitForResult, watchPromise } from "../../helpers";

describe("flutter for web debugger", () => {
	beforeEach("activate flutterWebHelloWorldMainFile", () => activate(flutterWebHelloWorldMainFile));
	before("get packages (0)", () => getPackages(flutterWebHelloWorldMainFile));
	before("get packages (1)", () => getPackages(flutterWebBrokenMainFile));

	let dc: DartDebugClient;
	beforeEach("create debug client", () => {
		dc = new DartDebugClient(process.execPath, path.join(ext.extensionPath, "out/extension/debug/flutter_web_debug_entry.js"), "dart", undefined, extApi.debugCommands, undefined);
		dc.defaultTimeout = 60000;
		const thisDc = dc;
		defer(() => thisDc.stop());
	});

	afterEach(() => watchPromise("Killing flutter_tester processes", killFlutterTester()));

	async function startDebugger(script?: vs.Uri | string, cwd?: string): Promise<vs.DebugConfiguration> {
		const config = await getLaunchConfiguration(script, {
			cwd,
			deviceId: "flutter-tester",
		});
		if (!config)
			throw new Error(`Could not get launch configuration (got ${config})`);
		await watchPromise("startDebugger->start", dc.start(config.debugServer));
		return config;
	}

	it("runs a Flutter web application and remains active until told to quit", async () => {
		const config = await startDebugger(flutterWebHelloWorldMainFile);
		await Promise.all([
			dc.assertOutputContains("stdout", "Serving `web` on http://localhost:"),
			dc.configurationSequence(),
			dc.launch(config),
		]);

		// Ensure we're still responsive after 10 seconds.
		await delay(10000);
		await dc.threadsRequest();

		await Promise.all([
			dc.waitForEvent("terminated"),
			dc.terminateRequest(),
		]);
	});

	it("expected debugger services are available in debug mode", async () => {
		const config = await startDebugger(flutterWebHelloWorldMainFile);
		await Promise.all([
			dc.configurationSequence(),
			dc.launch(config),
		]);

		await waitForResult(() => extApi.debugCommands.flutterExtensions.serviceIsRegistered(FlutterService.HotReload) === false); // TODO: Make true when supported!
		await waitForResult(() => extApi.debugCommands.flutterExtensions.serviceIsRegistered(FlutterService.HotRestart) === true);

		await Promise.all([
			dc.waitForEvent("terminated"),
			dc.terminateRequest(),
		]);

		await waitForResult(() => extApi.debugCommands.flutterExtensions.serviceIsRegistered(FlutterService.HotReload) === false);
		await waitForResult(() => extApi.debugCommands.flutterExtensions.serviceIsRegistered(FlutterService.HotRestart) === false);
	});

	it("expected debugger services are available in noDebug mode", async () => {
		const config = await startDebugger(flutterWebHelloWorldMainFile);
		config.noDebug = true;
		await Promise.all([
			dc.configurationSequence(),
			dc.launch(config),
		]);

		await waitForResult(() => extApi.debugCommands.flutterExtensions.serviceIsRegistered(FlutterService.HotReload) === false); // TODO: Make true when supported!
		await waitForResult(() => extApi.debugCommands.flutterExtensions.serviceIsRegistered(FlutterService.HotRestart) === true);

		await Promise.all([
			dc.waitForEvent("terminated"),
			dc.terminateRequest(),
		]);

		await waitForResult(() => extApi.debugCommands.flutterExtensions.serviceIsRegistered(FlutterService.HotReload) === false);
		await waitForResult(() => extApi.debugCommands.flutterExtensions.serviceIsRegistered(FlutterService.HotRestart) === false);
	});

	it("expected debugger service extensions are available in debug mode", async () => {
		const config = await startDebugger(flutterWebHelloWorldMainFile);
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
		const config = await startDebugger(flutterWebHelloWorldMainFile);
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

	it("can quit during a build", async () => {
		const config = await startDebugger(flutterWebHelloWorldMainFile);
		// Kick off a build, but do not await it...
		Promise.all([
			dc.configurationSequence(),
			dc.launch(config),
		]);

		// Wait 3 seconds to ensure the build is in progress...
		await delay(3000);

		// Send a disconnect request and ensure it happens within 5 seconds.
		await Promise.race([
			Promise.all([
				dc.waitForEvent("terminated"),
				dc.terminateRequest(),
			]),
			new Promise((resolve, reject) => setTimeout(() => reject(new Error("Did not complete terminateRequest within 5s")), 5000)),
		]);
	});

	it("runs a Flutter web application with a relative path", async () => {
		const config = await startDebugger(flutterWebHelloWorldMainFile);
		config.program = path.relative(fsPath(flutterWebHelloWorldFolder), fsPath(flutterWebHelloWorldMainFile));
		await Promise.all([
			dc.configurationSequence(),
			dc.launch(config),
		]);

		// Ensure we're still responsive after 10 seconds.
		await delay(10000);
		await dc.threadsRequest();

		await Promise.all([
			dc.waitForEvent("terminated"),
			dc.terminateRequest(),
		]);
	}).timeout(90000); // The 10 second delay makes this test slower and sometimes hit 60s.

	it("runs a Flutter web application with a variable in cwd", async () => {
		const config = await startDebugger(flutterWebHelloWorldMainFile, "${workspaceFolder}/hello_world/");
		config.program = path.relative(fsPath(flutterWebHelloWorldFolder), fsPath(flutterWebHelloWorldMainFile));
		await Promise.all([
			dc.configurationSequence(),
			dc.launch(config),
		]);

		// Ensure we're still responsive after 10 seconds.
		await delay(10000);
		await dc.threadsRequest();

		await Promise.all([
			dc.waitForEvent("terminated"),
			dc.terminateRequest(),
		]);
	});

	it.skip("hot reloads successfully", async () => {
		const config = await startDebugger(flutterWebHelloWorldMainFile);
		await Promise.all([
			watchPromise("hot_reloads_successfully->configurationSequence", dc.configurationSequence()),
			watchPromise("hot_reloads_successfully->launch", dc.launch(config)),
			// TODO: Remove this when we're not forced into noDebug mode, which
			// results in InitializedEvent coming immediately, before the debugger
			// is ready to accept reloads.
			dc.waitForEvent("dart.launched"),
		]);

		await watchPromise("hot_reloads_successfully->hotReload", dc.hotReload());

		await Promise.all([
			watchPromise("hot_reloads_successfully->waitForEvent:terminated", dc.waitForEvent("terminated")),
			watchPromise("hot_reloads_successfully->terminateRequest", dc.terminateRequest()),
		]);
	});

	it("hot restarts successfully", async () => {
		const config = await startDebugger(flutterWebHelloWorldMainFile);
		await Promise.all([
			dc.configurationSequence(),
			dc.launch(config),
			// TODO: Remove this when we're not forced into noDebug mode, which
			// results in InitializedEvent coming immediately, before the debugger
			// is ready to accept reloads.
			dc.waitForEvent("dart.launched"),
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

	it.skip("runs projects in sub-folders when the open file is in a project sub-folder", async () => {
		await openFile(flutterWebHelloWorldExampleSubFolderMainFile);
		const config = await startDebugger();
		await Promise.all([
			dc.configurationSequence(),
			dc.launch(config),
			// TODO: Remove this when we're not forced into noDebug mode, which
			// results in InitializedEvent coming immediately, before the debugger
			// is ready to accept reloads.
			dc.waitForEvent("dart.launched"),
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

	it.skip("runs projects in sub-folders when cwd is set to a project sub-folder", async () => {
		const config = await startDebugger(undefined, "example");
		await Promise.all([
			dc.configurationSequence(),
			dc.launch(config),
			// TODO: Remove this when we're not forced into noDebug mode, which
			// results in InitializedEvent coming immediately, before the debugger
			// is ready to accept reloads.
			dc.waitForEvent("dart.launched"),
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
		if (!extApi.flutterCapabilities.supportsDevTools) {
			this.skip();
			return;
		}

		const config = await startDebugger(flutterWebHelloWorldMainFile);
		await Promise.all([
			dc.configurationSequence(),
			dc.launch(config),
		]);

		const devTools = await vs.commands.executeCommand("dart.openDevTools") as { url: string, dispose: () => void };
		assert.ok(devTools);
		assert.ok(devTools.url);
		defer(devTools.dispose);

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
			if (!extApi.flutterCapabilities.webSupportsDebugging) {
				this.skip();
				return;
			}

			await openFile(flutterWebHelloWorldMainFile);
			const config = await startDebugger(flutterWebHelloWorldMainFile);
			const expectedLocation = {
				line: positionOf("^// BREAKPOINT1").line, // positionOf is 0-based, and seems to want 1-based, BUT comment is on next line!
				path: fsPath(flutterWebHelloWorldMainFile),
			};
			await watchPromise("stops_at_a_breakpoint->hitBreakpoint", dc.hitBreakpoint(config, expectedLocation));
			const stack = await dc.getStack();
			const frames = stack.body.stackFrames;
			assert.equal(frames[0].name, "MyHomePage.build");
			assert.equal(frames[0].source!.path, expectedLocation.path);
			assert.equal(frames[0].source!.name, "package:hello_world/main.dart");

			await watchPromise("stops_at_a_breakpoint->resume", dc.resume());

			// Add some invalid breakpoints because in the past they've caused us issues
			// https://github.com/Dart-Code/Dart-Code/issues/1437.
			// We need to also include expectedLocation since this overwrites all BPs.
			await dc.setBreakpointsRequest({
				breakpoints: [{ line: 0 }, expectedLocation],
				source: { path: fsPath(flutterWebHelloWorldMainFile) },
			});

			// Reload and ensure we hit the breakpoint on each one.
			for (let i = 0; i < numReloads; i++) {
				await delay(2000); // TODO: Remove this attempt to see if reloading too fast is causing our flakes...
				await Promise.all([
					watchPromise(`stops_at_a_breakpoint->reload:${i}->assertStoppedLocation:breakpoint`, dc.assertStoppedLocation("breakpoint", expectedLocation))
						.then(async (_) => {
							const stack = await watchPromise(`stops_at_a_breakpoint->reload:${i}->getStack`, dc.getStack());
							const frames = stack.body.stackFrames;
							assert.equal(frames[0].name, "MyHomePage.build");
							assert.equal(frames[0].source!.path, expectedLocation.path);
							assert.equal(frames[0].source!.name, "package:hello_world/main.dart");
						})
						.then((_) => watchPromise(`stops_at_a_breakpoint->reload:${i}->resume`, dc.resume())),
					watchPromise(`stops_at_a_breakpoint->reload:${i}->hotReload:breakpoint`, dc.hotReload()),
				]);
			}
		});
	});

	describe("can evaluate at breakpoint", () => {
		it("simple expressions", async function () {
			if (!extApi.flutterCapabilities.webSupportsDebugging) {
				this.skip();
				return;
			}

			await openFile(flutterWebHelloWorldMainFile);
			const config = await startDebugger(flutterWebHelloWorldMainFile);
			await Promise.all([
				dc.hitBreakpoint(config, {
					line: positionOf("^// BREAKPOINT1").line, // positionOf is 0-based, and seems to want 1-based, BUT comment is on next line!
					path: fsPath(flutterWebHelloWorldMainFile),
				}),
			]);

			const evaluateResult = await dc.evaluate(`"test"`);
			assert.ok(evaluateResult);
			assert.equal(evaluateResult.result, `"test"`);
			assert.equal(evaluateResult.variablesReference, 0);
		});

		it("complex expression expressions", async function () {
			if (!extApi.flutterCapabilities.webSupportsDebugging) {
				this.skip();
				return;
			}

			await openFile(flutterWebHelloWorldMainFile);
			const config = await startDebugger(flutterWebHelloWorldMainFile);
			await Promise.all([
				dc.hitBreakpoint(config, {
					line: positionOf("^// BREAKPOINT1").line, // positionOf is 0-based, and seems to want 1-based, BUT comment is on next line!
					path: fsPath(flutterWebHelloWorldMainFile),
				}),
			]);

			const evaluateResult = await dc.evaluate(`(new DateTime.now()).year`);
			assert.ok(evaluateResult);
			assert.equal(evaluateResult.result, (new Date()).getFullYear());
			assert.equal(evaluateResult.variablesReference, 0);
		});

		it("an expression that returns a variable", async function () {
			if (!extApi.flutterCapabilities.webSupportsDebugging) {
				this.skip();
				return;
			}

			await openFile(flutterWebHelloWorldMainFile);
			const config = await startDebugger(flutterWebHelloWorldMainFile);
			await Promise.all([
				dc.hitBreakpoint(config, {
					line: positionOf("^// BREAKPOINT1").line, // positionOf is 0-based, and seems to want 1-based, BUT comment is on next line!
					path: fsPath(flutterWebHelloWorldMainFile),
				}),
			]);

			const evaluateResult = await dc.evaluate(`new DateTime.now()`);
			const thisYear = new Date().getFullYear().toString();
			assert.ok(evaluateResult);
			assert.ok(evaluateResult.result.startsWith("DateTime (" + thisYear), `Result '${evaluateResult.result}' did not start with ${thisYear}`);
			assert.ok(evaluateResult.variablesReference);
		});

		it("complex expression expressions when in a top level function", async function () {
			if (!extApi.flutterCapabilities.webSupportsDebugging) {
				this.skip();
				return;
			}

			await openFile(flutterWebHelloWorldMainFile);
			const config = await startDebugger(flutterWebHelloWorldMainFile);
			await Promise.all([
				dc.hitBreakpoint(config, {
					line: positionOf("^// BREAKPOINT2").line, // positionOf is 0-based, and seems to want 1-based, BUT comment is on next line!
					path: fsPath(flutterWebHelloWorldMainFile),
				}),
			]);

			const evaluateResult = await dc.evaluate(`(new DateTime.now()).year`);
			assert.ok(evaluateResult);
			assert.equal(evaluateResult.result, (new Date()).getFullYear());
			assert.equal(evaluateResult.variablesReference, 0);
		});
	});

	// Skipped due to https://github.com/flutter/flutter/issues/17007.
	it.skip("stops on exception", async function () {
		if (!extApi.flutterCapabilities.webSupportsDebugging) {
			this.skip();
			return;
		}

		await openFile(flutterWebBrokenMainFile);
		const config = await startDebugger(flutterWebBrokenMainFile);
		await Promise.all([
			dc.configurationSequence(),
			dc.assertStoppedLocation("exception", {
				line: positionOf("^Oops").line + 1, // positionOf is 0-based, but seems to want 1-based
				path: fsPath(flutterWebBrokenMainFile),
			}),
			dc.launch(config),
		]);
	});

	// Skipped due to https://github.com/flutter/flutter/issues/17007.
	it.skip("provides exception details when stopped on exception", async function () {
		if (!extApi.flutterCapabilities.webSupportsDebugging) {
			this.skip();
			return;
		}

		await openFile(flutterWebBrokenMainFile);
		const config = await startDebugger(flutterWebBrokenMainFile);
		await Promise.all([
			dc.configurationSequence(),
			dc.assertStoppedLocation("exception", {
				line: positionOf("^won't find this").line + 1, // positionOf is 0-based, but seems to want 1-based
				path: fsPath(flutterWebBrokenMainFile),
			}),
			dc.launch(config),
		]);

		const variables = await dc.getTopFrameVariables("Exception");
		ensureVariable(variables, "$e.message", "message", `"(TODO WHEN UNSKIPPING)"`);
	});

	it("logs expected text (and does not stop) at a logpoint", async function () {
		if (!extApi.flutterCapabilities.webSupportsDebugging) {
			this.skip();
			return;
		}

		await openFile(flutterWebHelloWorldMainFile);
		const config = await watchPromise("logs_expected_text->startDebugger", startDebugger(flutterWebHelloWorldMainFile));
		await Promise.all([
			watchPromise("logs_expected_text->waitForEvent:initialized", dc.waitForEvent("initialized"))
				.then((event) => {
					return watchPromise("logs_expected_text->setBreakpointsRequest", dc.setBreakpointsRequest({
						// positionOf is 0-based, but seems to want 1-based
						breakpoints: [{
							line: positionOf("^// BREAKPOINT1").line,
							// VS Code says to use {} for expressions, but we want to support Dart's native too, so
							// we have examples of both (as well as "escaped" brackets).
							logMessage: "The \\{year} is {(new DateTime.now()).year}",
						}],
						source: { path: fsPath(flutterWebHelloWorldMainFile) },
					}));
				}).then((response) => watchPromise("logs_expected_text->configurationDoneRequest", dc.configurationDoneRequest())),
			watchPromise("logs_expected_text->assertOutputContainsYear", dc.assertOutputContains("stdout", `The {year} is ${(new Date()).getFullYear()}\n`)),
			watchPromise("logs_expected_text->launch", dc.launch(config)),
		]);
	});

	it("writes failure output", async () => {
		// This test really wants to check stderr, but since the widgets library catches the exception is
		// just comes via stdout.
		await openFile(flutterWebBrokenMainFile);
		const config = await startDebugger(flutterWebBrokenMainFile);
		await Promise.all([
			watchPromise("writes_failure_output->configurationSequence", dc.configurationSequence()),
			watchPromise("writes_failure_output->assertOutputContains", dc.assertOutputContains("stderr", "Exception: Oops\n")),
			watchPromise("writes_failure_output->launch", dc.launch(config)),
		]);
	});

	// Skipped due to https://github.com/dart-lang/webdev/issues/379
	it.skip("moves known files from call stacks to metadata", async () => {
		await openFile(flutterWebBrokenMainFile);
		const config = await startDebugger(flutterWebBrokenMainFile);
		await Promise.all([
			watchPromise("writes_failure_output->configurationSequence", dc.configurationSequence()),
			watchPromise(
				"writes_failure_output->assertOutputContains",
				dc.assertOutputContains("stderr", "methodThatThrows")
					.then((event) => {
						assert.equal(event.body.output.indexOf("package:broken/main.dart"), -1);
						assert.equal(event.body.source!.name, "package:broken/main.dart");
						assert.equal(event.body.source!.path, fsPath(flutterWebBrokenMainFile));
						assert.equal(event.body.line, positionOf("^Oops").line + 1); // positionOf is 0-based, but seems to want 1-based
						assert.equal(event.body.column, 5);
					}),
			),
			watchPromise("writes_failure_output->launch", dc.launch(config)),
		]);
	});
});
