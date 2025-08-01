import { strict as assert } from "assert";
import * as path from "path";
import * as vs from "vscode";
import { DebuggerType, VmService } from "../../../shared/enums";
import { fsPath } from "../../../shared/utils/fs";
import { DartDebugClient } from "../../dart_debug_client";
import { createDebugClient, ensureVariable, startDebugger, waitAllThrowIfTerminates } from "../../debug_helpers";
import { activate, closeAllOpenFiles, customScriptExt, defer, delay, ensureHasRunWithArgsStarting, getLaunchConfiguration, getPackages, logger, openFile, positionOf, prepareHasRunFile, privateApi, sb, setConfigForTest, waitForResult, watchPromise, webBrokenIndexFile, webBrokenMainFile, webHelloWorldExampleSubFolder, webHelloWorldExampleSubFolderIndexFile, webHelloWorldFolder, webHelloWorldIndexFile, webHelloWorldMainFile, webProjectContainerFolder } from "../../helpers";

describe("web debugger", () => {
	before("get packages (0)", () => getPackages(webHelloWorldIndexFile));
	before("get packages (1)", () => getPackages(webBrokenIndexFile));

	beforeEach("activate webHelloWorldIndexFile", () => activate(webHelloWorldIndexFile));

	let dc: DartDebugClient;
	beforeEach("create debug client", () => {
		dc = createDebugClient(DebuggerType.Web);
	});

	it("runs a web application and remains active until told to quit", async () => {
		const config = await startDebugger(dc, webHelloWorldIndexFile);
		await waitAllThrowIfTerminates(dc,
			watchPromise("assertOutputContains(serving web on)", dc.assertOutputContains("console", "Serving `web` on http://127.0.0.1:")),
			watchPromise("configurationSequence", dc.configurationSequence()),
			watchPromise("launch", dc.launch(config)),
		);

		// Ensure we're still responsive after 3 seconds.
		await delay(3000);
		await watchPromise("threadsRequest", dc.threadsRequest());

		await waitAllThrowIfTerminates(dc,
			watchPromise("waitForEvent(terminated)", dc.waitForEvent("terminated")),
			watchPromise("terminateRequest", dc.terminateRequest()),
		);
	});

	it("can run using a custom tool", async () => {
		const root = fsPath(webHelloWorldFolder);
		const hasRunFile = prepareHasRunFile(root, "web");

		const config = await startDebugger(dc, webHelloWorldIndexFile, {
			customTool: path.join(root, `scripts/custom_web.${customScriptExt}`),
			// (dart) pub global run webdev daemon
			customToolReplacesArgs: 5,
			toolArgs: "--",
		});
		await waitAllThrowIfTerminates(dc,
			watchPromise("assertOutputContains(serving web on)", dc.assertOutputContains("console", "Serving `web` on http://127.0.0.1:")),
			watchPromise("configurationSequence", dc.configurationSequence()),
			watchPromise("launch", dc.launch(config)),
		);
		await waitAllThrowIfTerminates(dc,
			watchPromise("waitForEvent(terminated)", dc.waitForEvent("terminated")),
			watchPromise("terminateRequest", dc.terminateRequest()),
		);

		ensureHasRunWithArgsStarting(root, hasRunFile, "--");
	});

	it("expected debugger services are available in debug mode", async () => {
		const config = await startDebugger(dc, webHelloWorldIndexFile);
		await waitAllThrowIfTerminates(dc,
			dc.configurationSequence(),
			dc.launch(config),
		);

		await waitForResult(() => privateApi.debugCommands.vmServices.serviceIsRegistered(VmService.HotReload) === false); // TODO: Make true when supported!

		await waitAllThrowIfTerminates(dc,
			dc.waitForEvent("terminated"),
			dc.terminateRequest(),
		);

		await waitForResult(() => privateApi.debugCommands.vmServices.serviceIsRegistered(VmService.HotReload) === false);
	});

	it("expected debugger services are available in noDebug mode", async () => {
		const config = await startDebugger(dc, webHelloWorldIndexFile);
		config.noDebug = true;
		await waitAllThrowIfTerminates(dc,
			dc.configurationSequence(),
			dc.launch(config),
		);

		await waitForResult(() => privateApi.debugCommands.vmServices.serviceIsRegistered(VmService.HotReload) === false); // TODO: Make true when supported!

		await waitAllThrowIfTerminates(dc,
			dc.waitForEvent("terminated"),
			dc.terminateRequest(),
		);

		await waitForResult(() => privateApi.debugCommands.vmServices.serviceIsRegistered(VmService.HotReload) === false);
	});

	// Skipped because this is super-flaky. If we quit to early, the processes are not
	// cleaned up properly. This should be fixed when we move to the un-forked version.
	it.skip("can quit during a build", async () => {
		const config = await startDebugger(dc, webHelloWorldIndexFile);
		// Kick off a build, but do not await it...
		// eslint-disable-next-line @typescript-eslint/no-floating-promises
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

	it("resolves relative paths", async () => {
		const config = await getLaunchConfiguration(
			path.relative(fsPath(webProjectContainerFolder), fsPath(webHelloWorldMainFile)),
		);
		assert.equal(config!.program, fsPath(webHelloWorldMainFile));
	});

	it("hot reloads successfully", async function () {
		if (!privateApi.dartCapabilities.webSupportsHotReload) {
			this.skip();
			return;
		}

		const config = await startDebugger(dc, webHelloWorldIndexFile);
		await waitAllThrowIfTerminates(dc,
			watchPromise("hot_reloads_successfully->configurationSequence", dc.configurationSequence()),
			watchPromise("hot_reloads_successfully->launch", dc.launch(config)),
		);

		await watchPromise("hot_reloads_successfully->hotReload", dc.hotReload());

		await waitAllThrowIfTerminates(dc,
			watchPromise("hot_reloads_successfully->waitForEvent:terminated", dc.waitForEvent("terminated")),
			watchPromise("hot_reloads_successfully->terminateRequest", dc.terminateRequest()),
		);
	});

	it("hot restarts successfully", async () => {
		const config = await startDebugger(dc, webHelloWorldIndexFile);
		await waitAllThrowIfTerminates(dc,
			dc.configurationSequence(),
			dc.launch(config),
		);

		// If we restart too fast, things fail :-/
		await delay(1000);

		await waitAllThrowIfTerminates(dc,
			dc.assertOutputContains("stdout", "Restarted app"),
			dc.customRequest("hotRestart"),
		);

		await waitAllThrowIfTerminates(dc,
			dc.waitForEvent("terminated"),
			dc.terminateRequest(),
		);
	});

	it.skip("resolves project program/cwds in sub-folders when the open file is in a project sub-folder", async () => {
		await openFile(webHelloWorldExampleSubFolderIndexFile);
		const config = await getLaunchConfiguration();
		assert.equal(config!.program, fsPath(webHelloWorldExampleSubFolderIndexFile));
		assert.equal(config!.cwd, fsPath(webHelloWorldExampleSubFolder));
	});

	it.skip("can run projects in sub-folders when cwd is set to a project sub-folder", async () => {
		await closeAllOpenFiles();
		const config = await getLaunchConfiguration(undefined, { cwd: "example" });
		assert.equal(config!.program, fsPath(webHelloWorldExampleSubFolderIndexFile));
		assert.equal(config!.cwd, fsPath(webHelloWorldExampleSubFolder));
	});

	it("can launch DevTools externally", async () => {
		await setConfigForTest("dart", "devToolsLocation", "external");

		const openBrowserCommand = sb.stub(privateApi.envUtils, "openInBrowser").resolves();

		const config = await startDebugger(dc, webHelloWorldIndexFile);
		await waitAllThrowIfTerminates(dc,
			watchPromise("launchDevTools->start->configurationSequence", dc.configurationSequence()),
			watchPromise("launchDevTools->start->launch", dc.launch(config)),
		);

		logger.info("Executing dart.openDevTools");
		const devTools = await vs.commands.executeCommand<{ url: string, dispose: () => void }>("dart.openDevTools");
		assert.ok(openBrowserCommand.calledOnce);
		assert.ok(devTools);
		assert.ok(devTools.url);
		defer("Dispose DevTools", devTools.dispose);

		const serverResponse = await privateApi.webClient.fetch(devTools.url);
		assert.notEqual(serverResponse.indexOf("Dart DevTools"), -1);

		await waitAllThrowIfTerminates(dc,
			dc.waitForEvent("terminated"),
			dc.terminateRequest(),
		);
	});

	const numReloads = 1;
	it(`stops at a breakpoint after each reload (${numReloads})`, async function () {
		if (!privateApi.dartCapabilities.webSupportsHotReload) {
			this.skip();
			return;
		}

		await openFile(webHelloWorldMainFile);
		const config = await startDebugger(dc, webHelloWorldIndexFile);
		const expectedLocation = {
			line: positionOf("^// BREAKPOINT1").line,
			path: dc.isUsingUris ? webHelloWorldMainFile.toString() : fsPath(webHelloWorldMainFile),
		};
		// TODO: Remove the last parameter here (and the other things below) when we are mapping breakpoints in org-dartland-app
		// URIs back to the correct file system paths.
		await watchPromise("stops_at_a_breakpoint->hitBreakpoint", dc.hitBreakpoint(config, expectedLocation, {}));
		// TODO: Put these back (and the ones below) when the above is fixed.
		// const stack = await dc.getStack();
		// const frames = stack.body.stackFrames;
		// assert.equal(frames[0].name, "main");
		// dc.assertPath(frames[0].source!.path, expectedLocation.path);
		// assert.equal(frames[0].source!.name, "package:hello_world/main.dart");

		await watchPromise("stops_at_a_breakpoint->resume", dc.resume());

		// Add some invalid breakpoints because in the past they've caused us issues
		// https://github.com/Dart-Code/Dart-Code/issues/1437.
		// We need to also include expectedLocation since this overwrites all BPs.
		await dc.setBreakpointsRequest({
			breakpoints: [{ line: 0 }, expectedLocation],
			source: { path: fsPath(webHelloWorldMainFile) },
		});

		// Reload and ensure we hit the breakpoint on each one.
		for (let i = 0; i < numReloads; i++) {
			await delay(2000); // TODO: Remove this attempt to see if reloading too fast is causing our flakes...
			await waitAllThrowIfTerminates(dc,
				// TODO: Remove the last parameter here (and the other things above and below) when we are mapping breakpoints in org-dartland-app
				// URIs back to the correct file system paths.
				watchPromise(`stops_at_a_breakpoint->reload:${i}->assertStoppedLocation:breakpoint`, dc.assertStoppedLocation("breakpoint", /* expectedLocation,*/ {}))
					.then(async () => {
						// TODO: Put these back (and the ones below) when the above is fixed.
						// const stack = await watchPromise(`stops_at_a_breakpoint->reload:${i}->getStack`, dc.getStack());
						// const frames = stack.body.stackFrames;
						// assert.equal(frames[0].name, "MyHomePage.build");
						// dc.assertPath(frames[0].source!.path, expectedLocation.path);
						// assert.equal(frames[0].source!.name, "package:hello_world/main.dart");
					})
					.then(() => watchPromise(`stops_at_a_breakpoint->reload:${i}->resume`, dc.resume())),
				watchPromise(`stops_at_a_breakpoint->reload:${i}->hotReload:breakpoint`, dc.hotReload()),
			);
		}
	});

	describe("can evaluate at breakpoint", () => {
		it("simple expressions", async () => {
			await openFile(webHelloWorldMainFile);
			const config = await startDebugger(dc, webHelloWorldIndexFile);
			await waitAllThrowIfTerminates(dc,
				dc.hitBreakpoint(config, {
					line: positionOf("^// BREAKPOINT1").line, // positionOf is 0-based, and seems to want 1-based, BUT comment is on next line!
					path: dc.isUsingUris ? webHelloWorldMainFile.toString() : fsPath(webHelloWorldMainFile),
				}, {}),
			);

			const evaluateResult = await dc.evaluateForFrame(`"test"`);
			assert.ok(evaluateResult);
			assert.equal(evaluateResult.result, `"test"`);
			assert.equal(evaluateResult.variablesReference, 0);
		});

		it("complex expressions", async () => {
			await openFile(webHelloWorldMainFile);
			const config = await startDebugger(dc, webHelloWorldIndexFile);
			await waitAllThrowIfTerminates(dc,
				dc.hitBreakpoint(config, {
					line: positionOf("^// BREAKPOINT1").line, // positionOf is 0-based, and seems to want 1-based, BUT comment is on next line!
					path: dc.isUsingUris ? webHelloWorldMainFile.toString() : fsPath(webHelloWorldMainFile),
				}, {}),
			);

			const evaluateResult = await dc.evaluateForFrame(`(new DateTime.now()).year`);
			assert.ok(evaluateResult);
			assert.equal(evaluateResult.result, (new Date()).getFullYear().toString());
			assert.equal(evaluateResult.variablesReference, 0);
		});

		it("an expression that returns a variable", async () => {
			await openFile(webHelloWorldMainFile);
			const config = await startDebugger(dc, webHelloWorldIndexFile);
			await waitAllThrowIfTerminates(dc,
				dc.hitBreakpoint(config, {
					line: positionOf("^// BREAKPOINT1").line, // positionOf is 0-based, and seems to want 1-based, BUT comment is on next line!
					path: dc.isUsingUris ? webHelloWorldMainFile.toString() : fsPath(webHelloWorldMainFile),
				}, {}),
			);

			const evaluateResult = await dc.evaluateForFrame(`new DateTime.now()`);
			const thisYear = new Date().getFullYear().toString();
			assert.ok(evaluateResult);
			assert.ok(evaluateResult.result.startsWith("DateTime (" + thisYear), `Result '${evaluateResult.result}' did not start with ${thisYear}`);
			assert.ok(evaluateResult.variablesReference);
		});

		it("complex expressions when in a top level function", async () => {
			await openFile(webHelloWorldMainFile);
			const config = await startDebugger(dc, webHelloWorldIndexFile);
			await waitAllThrowIfTerminates(dc,
				dc.hitBreakpoint(config, {
					line: positionOf("^// BREAKPOINT2").line,
					path: dc.isUsingUris ? webHelloWorldMainFile.toString() : fsPath(webHelloWorldMainFile),
				}, {}),
			);

			const evaluateResult = await dc.evaluateForFrame(`(new DateTime.now()).year`);
			assert.ok(evaluateResult);
			assert.equal(evaluateResult.result, (new Date()).getFullYear().toString());
			assert.equal(evaluateResult.variablesReference, 0);
		});
	});

	// Skipped because of:
	// - https://github.com/dart-lang/webdev/issues/2381
	// - https://github.com/dart-lang/webdev/issues/2382
	it.skip("stops on exception", async () => {
		await openFile(webBrokenMainFile);
		const config = await startDebugger(dc, webBrokenIndexFile);
		await waitAllThrowIfTerminates(dc,
			dc.configurationSequence(),
			dc.assertStoppedLocation("exception", {
				line: positionOf("^Oops").line + 1, // positionOf is 0-based, but seems to want 1-based
				path: dc.isUsingUris ? webBrokenMainFile.toString() : fsPath(webBrokenMainFile),
			}),
			dc.launch(config),
		);
	});

	// Skipped because of:
	// - https://github.com/dart-lang/webdev/issues/2381
	// - https://github.com/dart-lang/webdev/issues/2382
	it.skip("provides exception details when stopped on exception", async () => {
		await openFile(webBrokenMainFile);
		const config = await startDebugger(dc, webBrokenIndexFile);
		await waitAllThrowIfTerminates(dc,
			dc.configurationSequence(),
			dc.assertStoppedLocation("exception", {
				line: positionOf("^Oops").line + 1, // positionOf is 0-based, but seems to want 1-based
				path: dc.isUsingUris ? webBrokenMainFile.toString() : fsPath(webBrokenMainFile),
			}),
			dc.launch(config),
		);

		const variables = await dc.getTopFrameVariables("Exceptions");
		ensureVariable(variables, "$_threadException.message", "message", `"(TODO WHEN UNSKIPPING)"`);
	});

	it("logs expected text (and does not stop) at a logpoint", async () => {
		await openFile(webHelloWorldMainFile);
		const config = await watchPromise("logs_expected_text->startDebugger", startDebugger(dc, webHelloWorldIndexFile));
		await waitAllThrowIfTerminates(dc,
			watchPromise("logs_expected_text->waitForEvent:initialized", dc.waitForEvent("initialized"))
				.then(() => watchPromise("logs_expected_text->setBreakpointsRequest", dc.setBreakpointsRequest({
					breakpoints: [{
						line: positionOf("^// BREAKPOINT1").line,
						// VS Code says to use {} for expressions, but we want to support Dart's native too, so
						// we have examples of both (as well as "escaped" brackets).
						logMessage: "The \\{year} is {(new DateTime.now()).year}",
					}],
					source: { path: fsPath(webHelloWorldMainFile) },
				}))).then(() => watchPromise("logs_expected_text->configurationDoneRequest", dc.configurationDoneRequest())),
			watchPromise("logs_expected_text->assertOutputContainsYear", dc.assertOutputContains("stdout", `The {year} is ${(new Date()).getFullYear()}\n`)),
			watchPromise("logs_expected_text->launch", dc.launch(config)),
		);
	});

	// Skipped due to https://github.com/dart-lang/webdev/issues/837.
	it.skip("writes failure output", async () => {
		// This test really wants to check stderr, but since the widgets library catches the exception is
		// just comes via stdout.
		await openFile(webBrokenMainFile);
		const config = await startDebugger(dc, webBrokenIndexFile);
		await waitAllThrowIfTerminates(dc,
			watchPromise("writes_failure_output->configurationSequence", dc.configurationSequence()),
			watchPromise("writes_failure_output->assertOutputContains", dc.assertOutputContains("stderr", "Exception: Oops\n")),
			watchPromise("writes_failure_output->launch", dc.launch(config)),
		);
	});

	// Skipped due to https://github.com/dart-lang/webdev/issues/837.
	it.skip("moves known files from call stacks to metadata", async () => {
		await openFile(webBrokenMainFile);
		const config = await startDebugger(dc, webBrokenIndexFile);
		await waitAllThrowIfTerminates(dc,
			watchPromise("writes_failure_output->configurationSequence", dc.configurationSequence()),
			watchPromise(
				"writes_failure_output->assertOutputContains",
				dc.assertOutputContains("stderr", "methodThatThrows")
					.then((event) => {
						assert.equal(event.body.output.indexOf("package:broken/main.dart"), -1);
						assert.equal(event.body.source!.name, "package:broken/main.dart");
						dc.assertPath(event.body.source!.path, dc.isUsingUris ? webBrokenMainFile.toString() : fsPath(webBrokenMainFile));
						assert.equal(event.body.line, positionOf("^Oops").line + 1); // positionOf is 0-based, but seems to want 1-based
						assert.equal(event.body.column, 5);
					}),
			),
			watchPromise("writes_failure_output->launch", dc.launch(config)),
		);
	});
});
