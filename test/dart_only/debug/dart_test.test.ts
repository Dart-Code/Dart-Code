import * as assert from "assert";
import * as path from "path";
import * as vs from "vscode";
import { DebugProtocol } from "vscode-debugprotocol";
import { fsPath, versionIsAtLeast } from "../../../src/utils";
import { DartDebugClient } from "../../dart_debug_client";
import { activate, defer, ext, getLaunchConfiguration, getPackages, helloWorldTestBrokenFile, helloWorldTestMainFile, openFile, positionOf } from "../../helpers";

describe.skip("dart test debugger", () => {
	// We have tests that require external packages.
	before("get packages", () => getPackages());

	let testPrefix = "- ";
	beforeEach("activate helloWorldTestMainFile", async () => {
		await activate(helloWorldTestMainFile);
		if (versionIsAtLeast(ext.exports.analyzerCapabilities.version, "1.20.3"))
			testPrefix = "";
	});

	let dc: DartDebugClient;
	beforeEach("create debug client", () => {
		dc = new DartDebugClient(process.execPath, path.join(ext.extensionPath, "out/src/debug/dart_test_debug_entry.js"), "dart");
		dc.defaultTimeout = 30000;
		defer(() => dc.stop());
	});

	async function startDebugger(script: vs.Uri | string, throwOnError = true): Promise<vs.DebugConfiguration> {
		const config = await getLaunchConfiguration(script);
		await dc.start(config.debugServer);

		// TODO: Remove copies of these...
		// Throw to fail tests if we get any error output to aid debugging.
		if (throwOnError) {
			dc.on("output", (event: DebugProtocol.OutputEvent) => {
				if (event.body.category === "stderr")
					throw new Error(event.body.output);
			});
		}
		return config;
	}

	it("runs a Dart test script to completion", async () => {
		const config = await startDebugger(helloWorldTestMainFile);
		await Promise.all([
			dc.configurationSequence(),
			dc.waitForEvent("terminated"),
			dc.launch(config),
		]);
	});

	it("receives the expected events from a Dart test script", async () => {
		const config = await startDebugger(helloWorldTestMainFile);
		await Promise.all([
			dc.configurationSequence(),
			dc.assertOutput("stdout", `✓ ${testPrefix}Hello world test`),
			dc.waitForEvent("terminated"),
			dc.assertPassingTest("- Hello world test"),
			dc.assertOutput("stdout", "✓ - Hello world test"),
			dc.launch(config),
		]);
	});

	// Skipped due to
	// https://github.com/flutter/flutter/issues/16352
	it.skip("stops at a breakpoint", async () => {
		await openFile(helloWorldTestMainFile);
		const config = await startDebugger(helloWorldTestMainFile);
		await Promise.all([
			dc.hitBreakpoint(config, {
				line: positionOf("^// BREAKPOINT1").line + 1, // positionOf is 0-based, but seems to want 1-based
				path: fsPath(helloWorldTestMainFile),
			}),
		]);
	});

	it.skip("stops on exception", async () => {
		await openFile(helloWorldTestBrokenFile);
		const config = await startDebugger(helloWorldTestBrokenFile);
		await Promise.all([
			dc.configurationSequence(),
			dc.assertStoppedLocation("exception", {}),
			dc.launch(config),
		]);
	});

	// Skipped due to:
	// https://github.com/dart-lang/sdk/issues/29156
	// and
	// https://github.com/flutter/flutter/issues/16352
	it.skip("stops at the correct location on exception", async () => {
		await openFile(helloWorldTestBrokenFile);
		const config = await startDebugger(helloWorldTestBrokenFile);
		await Promise.all([
			dc.configurationSequence(),
			dc.assertStoppedLocation("exception", {
				line: positionOf("^won't find this").line + 1, // positionOf is 0-based, but seems to want 1-based
				path: fsPath(helloWorldTestBrokenFile),
			}),
			dc.launch(config),
		]);
	});

	it.skip("provides exception details when stopped on exception", async () => {
		await openFile(helloWorldTestBrokenFile);
		const config = await startDebugger(helloWorldTestBrokenFile, false);
		await Promise.all([
			dc.configurationSequence(),
			dc.assertStoppedLocation("exception", {}),
			dc.launch(config),
		]);

		const variables = await dc.getTopFrameVariables("Exception") as DebugProtocol.Variable[];
		assert.ok(variables);
		const v = variables.find((v) => v.name === "message");
		assert.ok(v);
		assert.equal(v.evaluateName, "$e.message");
		assert.ok(v.value.startsWith(`"Expected: exactly one matching node in the widget tree`));
	});

	it("send failure results for failing tests", async () => {
		await openFile(helloWorldTestBrokenFile);
		const config = await startDebugger(helloWorldTestBrokenFile, false);
		config.noDebug = true;
		await Promise.all([
			dc.configurationSequence(),
			dc.assertErroringTest("- Hello world test"),
			dc.assertOutput("stderr", "Test failed. See exception logs above."),
			dc.assertOutputContains("stdout", "EXCEPTION CAUGHT BY FLUTTER TEST FRAMEWORK"),
			dc.launch(config),
		]);
	});
});
