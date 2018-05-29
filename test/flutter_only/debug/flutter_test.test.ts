import * as assert from "assert";
import * as path from "path";
import * as vs from "vscode";
import { DebugProtocol } from "vscode-debugprotocol";
import { fsPath } from "../../../src/utils";
import { DartDebugClient } from "../../dart_debug_client";
import { activate, defer, ext, flutterHelloWorldFolder, flutterTestBrokenFile, flutterTestMainFile, flutterTestOtherFile, getLaunchConfiguration, openFile, positionOf } from "../../helpers";

describe("flutter test debugger", () => {
	beforeEach("activate flutterTestMainFile", () => activate(flutterTestMainFile));
	beforeEach("set timeout", function () {
		this.timeout(60000); // These tests can be slow due to flutter package fetches when running.
	});

	let dc: DartDebugClient;
	beforeEach("create debug client", () => {
		dc = new DartDebugClient(process.execPath, path.join(ext.extensionPath, "out/src/debug/flutter_test_debug_entry.js"), "dart");
		dc.defaultTimeout = 30000;
		defer(() => dc.stop());
	});

	async function startDebugger(script: vs.Uri | string, throwOnError = true): Promise<vs.DebugConfiguration> {
		const config = await getLaunchConfiguration(script);
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

	it("runs a Flutter test script to completion", async () => {
		const config = await startDebugger(flutterTestMainFile);
		await Promise.all([
			dc.configurationSequence(),
			dc.waitForEvent("terminated"),
			dc.launch(config),
		]);
	});

	it("receives the expected output from a Flutter test script", async () => {
		const config = await startDebugger(flutterTestMainFile);
		await Promise.all([
			dc.configurationSequence(),
			dc.assertOutput("stdout", "✓ - Hello world test"),
			dc.waitForEvent("terminated"),
			dc.launch(config),
		]);
	});

	it("receives the expected output from a Flutter test script when run with variables in launch config", async () => {
		const relativePath = path.relative(fsPath(flutterHelloWorldFolder), fsPath(flutterTestMainFile));
		const config = await startDebugger(`\${workspaceFolder}/${relativePath}`);
		await Promise.all([
			dc.configurationSequence(),
			dc.assertOutput("stdout", "✓ - Hello world test"),
			dc.waitForEvent("terminated"),
			dc.launch(config),
		]);
	});

	it("successfully runs a Flutter test script with a relative path", async () => {
		const config = await startDebugger(flutterTestMainFile);
		config.program = path.relative(fsPath(flutterHelloWorldFolder), fsPath(flutterTestMainFile));
		await Promise.all([
			dc.configurationSequence(),
			dc.assertOutput("stdout", "✓ - Hello world test"),
			dc.waitForEvent("terminated"),
			dc.launch(config),
		]);
	});

	it("runs the provided script regardless of what's open", async () => {
		await openFile(flutterTestMainFile);
		const config = await startDebugger(flutterTestOtherFile);
		await Promise.all([
			dc.configurationSequence(),
			dc.assertOutput("stdout", "✓ - Other test\n"),
			dc.waitForEvent("terminated"),
			dc.launch(config),
		]);
	});

	it("runs the open script if no file is provided", async () => {
		await openFile(flutterTestOtherFile);
		const config = await startDebugger(null);
		await Promise.all([
			dc.configurationSequence(),
			dc.assertOutput("stdout", "✓ - Other test\n"),
			dc.waitForEvent("terminated"),
			dc.launch(config),
		]);
	});

	it("runs the open script if program is set to ${file}", async () => {
		await openFile(flutterTestOtherFile);
		const config = await startDebugger("${file}");
		await Promise.all([
			dc.configurationSequence(),
			dc.assertOutput("stdout", "✓ - Other test\n"),
			dc.waitForEvent("terminated"),
			dc.launch(config),
		]);
	});

	// Skipped due to
	// https://github.com/flutter/flutter/issues/16352
	it.skip("stops at a breakpoint", async () => {
		await openFile(flutterTestMainFile);
		const config = await startDebugger(flutterTestMainFile);
		await Promise.all([
			dc.hitBreakpoint(config, {
				line: positionOf("^// BREAKPOINT1").line + 1, // positionOf is 0-based, but seems to want 1-based
				path: fsPath(flutterTestMainFile),
			}),
		]);
	});

	it.skip("stops on exception", async () => {
		await openFile(flutterTestBrokenFile);
		const config = await startDebugger(flutterTestBrokenFile);
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
		await openFile(flutterTestBrokenFile);
		const config = await startDebugger(flutterTestBrokenFile);
		await Promise.all([
			dc.configurationSequence(),
			dc.assertStoppedLocation("exception", {
				line: positionOf("^won't find this").line + 1, // positionOf is 0-based, but seems to want 1-based
				path: fsPath(flutterTestBrokenFile),
			}),
			dc.launch(config),
		]);
	});

	it.skip("provides exception details when stopped on exception", async () => {
		await openFile(flutterTestBrokenFile);
		const config = await startDebugger(flutterTestBrokenFile, false);
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

	it("writes failure output to stderr", async () => {
		await openFile(flutterTestBrokenFile);
		const config = await startDebugger(flutterTestBrokenFile, false);
		config.noDebug = true;
		await Promise.all([
			dc.configurationSequence(),
			dc.assertOutput("stderr", "Test failed. See exception logs above."),
			dc.launch(config),
		]);
	});
});
