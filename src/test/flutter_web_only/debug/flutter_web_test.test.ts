import * as assert from "assert";
import * as path from "path";
import * as vs from "vscode";
import { DebugProtocol } from "vscode-debugprotocol";
import { fsPath } from "../../../extension/utils";
import { logInfo } from "../../../extension/utils/log";
import { DartDebugClient } from "../../dart_debug_client";
import { killFlutterTester } from "../../debug_helpers";
import { activate, defer, delay, ext, extApi, flutterWebHelloWorldFolder, flutterWebTestBrokenFile, flutterWebTestMainFile, flutterWebTestOtherFile, getLaunchConfiguration, openFile, positionOf, withTimeout } from "../../helpers";

describe.skip("flutter for web test debugger", () => {
	beforeEach("activate flutterWebTestMainFile", async () => {
		await activate(flutterWebTestMainFile);
	});

	let dc: DartDebugClient;
	beforeEach("create debug client", () => {
		dc = new DartDebugClient(
			process.execPath,
			path.join(ext.extensionPath, "out/extension/debug/flutter_web_test_debug_entry.js"),
			"dart",
			undefined,
			extApi.debugCommands,
			extApi.testTreeProvider,
		);
		dc.defaultTimeout = 60000;
		// The test runner doesn't quit on the first SIGINT, it prints a message that it's waiting for the
		// test to finish and then runs cleanup. Since we don't care about this for these tests, we just send
		// a second request and that'll cause it to quit immediately.
		const thisDc = dc;
		defer(() => withTimeout(
			Promise.all([
				thisDc.terminateRequest().catch((e) => logInfo(e)),
				delay(500).then(() => thisDc.stop()).catch((e) => logInfo(e)),
			]),
			"Timed out disconnecting - this is often normal because we have to try to quit twice for the test runner",
			60,
		));
	});

	afterEach(killFlutterTester);

	async function startDebugger(script?: vs.Uri | string): Promise<vs.DebugConfiguration> {
		const config = await getLaunchConfiguration(script);
		await dc.start(config.debugServer);
		return config;
	}

	it("runs a Flutter test script to completion", async () => {
		const config = await startDebugger(flutterWebTestMainFile);
		await Promise.all([
			dc.configurationSequence(),
			dc.waitForEvent("terminated"),
			dc.launch(config),
		]);
	});

	it("receives the expected events from a Flutter test script", async () => {
		const config = await startDebugger(flutterWebTestMainFile);
		await Promise.all([
			dc.configurationSequence(),
			dc.assertOutput("stdout", `✓ Hello world test`),
			dc.waitForEvent("terminated"),
			dc.assertPassingTest(`Hello world test`),
			dc.launch(config),
		]);
	});

	it("receives the expected events from a Flutter test script when run with variables in launch config", async () => {
		const relativePath = path.relative(fsPath(flutterWebHelloWorldFolder), fsPath(flutterWebTestMainFile));
		const config = await startDebugger(`\${workspaceFolder}/${relativePath}`);
		await Promise.all([
			dc.configurationSequence(),
			dc.assertOutput("stdout", `✓ Hello world test`),
			dc.assertPassingTest(`Hello world test`),
			dc.waitForEvent("terminated"),
			dc.launch(config),
		]);
	});

	it("successfully runs a Flutter test script with a relative path", async () => {
		const config = await startDebugger(flutterWebTestMainFile);
		config.program = path.relative(fsPath(flutterWebHelloWorldFolder), fsPath(flutterWebTestMainFile));
		await Promise.all([
			dc.configurationSequence(),
			dc.assertOutput("stdout", `✓ Hello world test`),
			dc.assertPassingTest(`Hello world test`),
			dc.waitForEvent("terminated"),
			dc.launch(config),
		]);
	});

	it("runs the provided script regardless of what's open", async () => {
		await openFile(flutterWebTestMainFile);
		const config = await startDebugger(flutterWebTestOtherFile);
		await Promise.all([
			dc.configurationSequence(),
			dc.assertOutput("stdout", `✓ Other tests group Other test\n`),
			dc.assertPassingTest(`Other tests group Other test`),
			dc.waitForEvent("terminated"),
			dc.launch(config),
		]);
	});

	it("runs the open script if no file is provided", async () => {
		await openFile(flutterWebTestOtherFile);
		const config = await startDebugger(undefined);
		await Promise.all([
			dc.configurationSequence(),
			dc.assertOutput("stdout", `✓ Other tests group Other test\n`),
			dc.assertPassingTest(`Other tests group Other test`),
			dc.waitForEvent("terminated"),
			dc.launch(config),
		]);
	});

	it("runs the open script if program is set to ${file}", async () => {
		await openFile(flutterWebTestOtherFile);
		const config = await startDebugger("${file}");
		await Promise.all([
			dc.configurationSequence(),
			dc.assertOutput("stdout", `✓ Other tests group Other test\n`),
			dc.assertPassingTest(`Other tests group Other test`),
			dc.waitForEvent("terminated"),
			dc.launch(config),
		]);
	});

	it("runs all tests if given a folder", async () => {
		const config = await startDebugger("./test/");
		config.noDebug = true;
		await Promise.all([
			dc.configurationSequence(),
			dc.waitForEvent("terminated"),
			dc.launch(config),
		]);

		const topLevelNodes = extApi.testTreeProvider.getChildren();
		assert.ok(topLevelNodes);
		assert.equal(topLevelNodes.length, 3);
	});

	it("stops at a breakpoint", async () => {
		await openFile(flutterWebTestMainFile);
		const config = await startDebugger(flutterWebTestMainFile);
		await dc.hitBreakpoint(config, {
			line: positionOf("^// BREAKPOINT1").line + 1, // positionOf is 0-based, but seems to want 1-based
			path: fsPath(flutterWebTestMainFile),
		});
	});

	it("stops on exception", async () => {
		await openFile(flutterWebTestBrokenFile);
		const config = await startDebugger(flutterWebTestBrokenFile);
		await Promise.all([
			dc.configurationSequence(),
			dc.assertStoppedLocation("exception", {}),
			dc.launch(config),
		]);
	});

	it.skip("stops at the correct location on exception", async () => {
		// TODO: Check the expected location is in the call stack, and that the frames above it are all marked
		// as deemphasized.
		await openFile(flutterWebTestBrokenFile);
		const config = await startDebugger(flutterWebTestBrokenFile);
		await Promise.all([
			dc.configurationSequence(),
			dc.assertStoppedLocation("exception", {
				line: positionOf("^won't find this").line + 1, // positionOf is 0-based, but seems to want 1-based
				path: fsPath(flutterWebTestBrokenFile),
			}),
			dc.launch(config),
		]);
	});

	it("provides exception details when stopped on exception", async () => {
		await openFile(flutterWebTestBrokenFile);
		const config = await startDebugger(flutterWebTestBrokenFile);
		await Promise.all([
			dc.configurationSequence(),
			dc.assertStoppedLocation("exception", {}),
			dc.launch(config),
		]);

		const variables = await dc.getTopFrameVariables("Exception") as DebugProtocol.Variable[];
		assert.ok(variables);
		let v = variables.find((v) => v.name === "message");
		assert.ok(v);
		v = v!;
		assert.equal(v.evaluateName, "$e.message");
		assert.ok(v.value.startsWith(`"Expected: exactly one matching node in the widget tree`));
	});

	it("send failure results for failing tests", async () => {
		await openFile(flutterWebTestBrokenFile);
		const config = await startDebugger(flutterWebTestBrokenFile);
		config.noDebug = true;
		await Promise.all([
			dc.configurationSequence(),
			dc.assertErroringTest(`Hello world test`),
			dc.assertOutput("stderr", "Test failed. See exception logs above.\n"),
			dc.assertOutputContains("stdout", "EXCEPTION CAUGHT BY FLUTTER TEST FRAMEWORK"),
			dc.launch(config),
		]);
	});
});
