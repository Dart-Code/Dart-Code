import * as assert from "assert";
import * as path from "path";
import * as vs from "vscode";
import { DebugProtocol } from "vscode-debugprotocol";
import { fsPath } from "../../../src/utils";
import { DartDebugClient } from "../../dart_debug_client";
import { activate, defer, ext, getLaunchConfiguration, getPackages, helloWorldTestBrokenFile, helloWorldTestMainFile, openFile, platformEol, positionOf } from "../../helpers";

describe("dart test debugger", () => {
	// We have tests that require external packages.
	before("get packages", () => getPackages());

	beforeEach("activate helloWorldTestMainFile", () => activate(helloWorldTestMainFile));

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
			dc.assertOutput("stdout", `✓ String .split() splits the string on the delimiter`),
			dc.waitForEvent("terminated"),
			dc.assertPassingTest("String .split() splits the string on the delimiter"),
			dc.launch(config),
		]);
	});

	it("stops at a breakpoint", async () => {
		await openFile(helloWorldTestMainFile);
		const config = await startDebugger(helloWorldTestMainFile);
		await Promise.all([
			dc.hitBreakpoint(config, {
				line: positionOf("^// BREAKPOINT1").line + 1, // positionOf is 0-based, but seems to want 1-based
				path: fsPath(helloWorldTestMainFile),
			}),
		]);
	});

	it("stops on exception", async () => {
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
	it.skip("stops at the correct location on exception", async () => {
		await openFile(helloWorldTestBrokenFile);
		const config = await startDebugger(helloWorldTestBrokenFile);
		await Promise.all([
			dc.configurationSequence(),
			dc.assertStoppedLocation("exception", {
				line: positionOf("^expect(1, equals(2))").line + 1, // positionOf is 0-based, but seems to want 1-based
				path: fsPath(helloWorldTestBrokenFile),
			}),
			dc.launch(config),
		]);
	});

	it("provides exception details when stopped on exception", async () => {
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
		const expectedStart = `"Expected: <2>${platformEol}  Actual: <1>`;
		assert.ok(
			v.value.startsWith(expectedStart),
			`Exception didn't have expected prefix\n` +
			`+ expected - actual\n` +
			`+ ${JSON.stringify(expectedStart)}\n` +
			`- ${JSON.stringify(v.value)}\n`,
		);
	});

	it("sends failure results for failing tests", async () => {
		await openFile(helloWorldTestBrokenFile);
		const config = await startDebugger(helloWorldTestBrokenFile, false);
		config.noDebug = true;
		await Promise.all([
			dc.configurationSequence(),
			dc.assertFailingTest("might fail today"),
			dc.assertOutput("stderr", `Expected: <2>${platformEol}  Actual: <1>`),
			dc.launch(config),
		]);
	});
});
