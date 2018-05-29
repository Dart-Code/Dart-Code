import * as path from "path";
import * as vs from "vscode";
import { DebugProtocol } from "vscode-debugprotocol";
import { fsPath } from "../../../src/utils";
import { DartDebugClient } from "../../dart_debug_client";
import { ensureVariable } from "../../debug_helpers";
import { activate, defer, delay, ext, flutterHelloWorldBrokenFile, flutterHelloWorldFolder, flutterHelloWorldMainFile, getLaunchConfiguration, isWin, openFile, positionOf } from "../../helpers";

describe("flutter run debugger", () => {
	beforeEach("skip if no test device", function () {
		if (!ext.exports.analyzerCapabilities.flutterHasTestDevice)
			this.skip();
		// Skip on Windows due to https://github.com/flutter/flutter/issues/17833
		if (isWin)
			this.skip();
	});

	// We don't commit all the iOS/Android stuff to this repo to save space, but we can bring it back with
	// `flutter create .`!
	before("run 'flutter create'", () => vs.commands.executeCommand("_flutter.create", path.join(fsPath(flutterHelloWorldFolder), "dummy"), "."));

	beforeEach("set timeout", function () {
		this.timeout(60000); // These tests can be slow due to flutter package fetches when running.
	});

	beforeEach("activate flutterHelloWorldMainFile", () => activate(flutterHelloWorldMainFile));

	let dc: DartDebugClient;
	beforeEach("create debug client", () => {
		dc = new DartDebugClient(process.execPath, path.join(ext.extensionPath, "out/src/debug/flutter_debug_entry.js"), "dart");
		dc.defaultTimeout = 30000;
		defer(() => dc.stop());
	});

	beforeEach("activate flutterHelloWorldMainFile", () => activate(flutterHelloWorldMainFile));
	beforeEach("set timeout", function () {
		this.timeout(60000); // These tests can be slow due to flutter package fetches when running.
	});

	async function startDebugger(script: vs.Uri | string, cwd?: string, throwOnError = true): Promise<vs.DebugConfiguration> {
		const config = await getLaunchConfiguration(script, { deviceId: "flutter-tester" });
		await dc.start(config.debugServer);

		// Throw to fail tests if we get any error output to aid debugging.
		if (throwOnError) {
			dc.on("output", (event: DebugProtocol.OutputEvent) => {
				if (event.body.category === "stderr")
					throw new Error(event.body.output);
			});
		}
		return config;
	}

	it.skip("runs a Flutter application and remains active until told to quit", async () => {
		const config = await startDebugger(flutterHelloWorldMainFile);
		await Promise.all([
			dc.configurationSequence(),
			dc.launch(config),
		]);

		// Ensure we're still responsive after 10 seconds.
		await delay(10000);
		await dc.threadsRequest();

		await dc.disconnectRequest();
		await dc.waitForEvent("terminated");
	});

	it.skip("runs a Flutter application with a relative path", async () => {
		const config = await startDebugger(flutterHelloWorldMainFile);
		config.program = path.relative(fsPath(flutterHelloWorldFolder), fsPath(flutterHelloWorldMainFile));
		await Promise.all([
			dc.configurationSequence(),
			dc.launch(config),
		]);

		// Ensure we're still responsive after 10 seconds.
		await delay(10000);
		await dc.threadsRequest();

		await dc.disconnectRequest();
		await dc.waitForEvent("terminated");
	});

	it.skip("runs a Flutter application with a variable in cwd", async () => {
		const config = await startDebugger(flutterHelloWorldMainFile, "${workspaceFolder}/");
		config.program = path.relative(fsPath(flutterHelloWorldFolder), fsPath(flutterHelloWorldMainFile));
		await Promise.all([
			dc.configurationSequence(),
			dc.launch(config),
		]);

		// Ensure we're still responsive after 10 seconds.
		await delay(10000);
		await dc.threadsRequest();

		await dc.disconnectRequest();
		await dc.waitForEvent("terminated");
	});

	it("stops at a breakpoint", async () => {
		await openFile(flutterHelloWorldMainFile);
		const config = await startDebugger(flutterHelloWorldMainFile);
		await Promise.all([
			dc.hitBreakpoint(config, {
				line: positionOf("^// BREAKPOINT1").line, // positionOf is 0-based, and seems to want 1-based, BUT comment is on next line!
				path: fsPath(flutterHelloWorldMainFile),
			}),
		]);
	});

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
	});

	it.skip("provides exception details when stopped on exception", async () => {
		await openFile(flutterHelloWorldBrokenFile);
		const config = await startDebugger(flutterHelloWorldBrokenFile, undefined, false);
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
	});

	// Failing due to https://github.com/flutter/flutter/issues/18160
	it.skip("logs expected text (and does not stop) at a logpoint", async () => {
		await openFile(flutterHelloWorldMainFile);
		const config = await startDebugger(flutterHelloWorldMainFile);
		await Promise.all([
			dc.waitForEvent("initialized").then((event) => {
				return dc.setBreakpointsRequest({
					// positionOf is 0-based, but seems to want 1-based
					breakpoints: [{
						line: positionOf("^// BREAKPOINT1").line,
						// VS Code says to use {} for expressions, but we want to support Dart's native too, so
						// we have examples of both (as well as "escaped" brackets).
						logMessage: "The \\{year} is {(new DateTime.now()).year}",
					}],
					source: { path: fsPath(flutterHelloWorldMainFile) },
				});
			}).then((response) => dc.configurationDoneRequest()),
			dc.assertOutput("stdout", `The {year} is ${(new Date()).getFullYear()}`),
			dc.launch(config),
		]);
	});

	it.skip("writes failure output to stderr", async () => {
		await openFile(flutterHelloWorldBrokenFile);
		const config = await startDebugger(flutterHelloWorldBrokenFile, undefined, false);
		await Promise.all([
			dc.configurationSequence(),
			dc.assertOutput("stderr", "Test failed. See exception logs above."),
			dc.launch(config),
		]);
	});
});
