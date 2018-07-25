import * as assert from "assert";
import * as path from "path";
import * as vs from "vscode";
import { DebugProtocol } from "vscode-debugprotocol";
import { OpenFileTracker } from "../../../src/analysis/open_file_tracker";
import { fsPath } from "../../../src/utils";
import { log, logInfo } from "../../../src/utils/log";
import { TestOutlineVisitor } from "../../../src/utils/outline";
import { makeRegexForTest } from "../../../src/utils/test";
import { TestResultsProvider, TestStatus } from "../../../src/views/test_view";
import { DartDebugClient } from "../../dart_debug_client";
import { activate, defer, delay, ext, extApi, getExpectedResults, getLaunchConfiguration, getPackages, helloWorldTestBrokenFile, helloWorldTestMainFile, helloWorldTestSkipFile, helloWorldTestTreeFile, openFile, positionOf, withTimeout } from "../../helpers";

describe("dart test debugger", () => {
	// We have tests that require external packages.
	before("get packages", () => getPackages());
	beforeEach("activate helloWorldTestMainFile", () => activate(helloWorldTestMainFile));

	let dc: DartDebugClient;
	beforeEach("create debug client", () => {
		dc = new DartDebugClient(
			process.execPath,
			path.join(ext.extensionPath, "out/src/debug/dart_test_debug_entry.js"),
			"dart",
			undefined,
			extApi.testTreeProvider,
		);
		dc.defaultTimeout = 30000;
		// The test runner doesn't quit on the first SIGINT, it prints a message that it's waiting for the
		// test to finish and then runs cleanup. Since we don't care about this for these tests, we just send
		// a second request and that'll cause it to quit immediately.
		defer(() => withTimeout(
			Promise.all([
				dc.disconnectRequest().catch((e) => logInfo(e)),
				delay(500).then(() => dc.stop()).catch((e) => logInfo(e)),
			]),
			"Timed out disconnecting - this is often normal because we have to try to quit twice for the test runner",
		));
	});

	async function startDebugger(script: vs.Uri | string, extraConfiguration?: { [key: string]: any }): Promise<vs.DebugConfiguration> {
		const config = await getLaunchConfiguration(script, extraConfiguration);
		await dc.start(config.debugServer);
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
			dc.assertPassingTest("String .split() splits the string on the delimiter"),
			dc.waitForEvent("terminated"),
			dc.launch(config),
		]);
	});

	it("stops at a breakpoint", async () => {
		await openFile(helloWorldTestMainFile);
		const config = await startDebugger(helloWorldTestMainFile);
		await dc.hitBreakpoint(config, {
			line: positionOf("^// BREAKPOINT1").line + 1, // positionOf is 0-based, but seems to want 1-based
			path: fsPath(helloWorldTestMainFile),
		});
	});

	it("stops on exception", async function () {
		// Dart v1 doesn't pause on unhandled exceptions here :(
		if (!extApi.analyzerCapabilities.isDart2)
			this.skip();
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

	it("provides exception details when stopped on exception", async function () {
		// Dart v1 doesn't pause on unhandled exceptions here :(
		if (!extApi.analyzerCapabilities.isDart2)
			this.skip();
		await openFile(helloWorldTestBrokenFile);
		const config = await startDebugger(helloWorldTestBrokenFile);
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
		const expectedStart = `"Expected: <2>\n  Actual: <1>`;
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
		const config = await startDebugger(helloWorldTestBrokenFile);
		config.noDebug = true;
		await Promise.all([
			dc.configurationSequence(),
			dc.assertFailingTest("might fail today"),
			dc.assertOutput("stderr", `Expected: <2>\n  Actual: <1>`),
			dc.launch(config),
		]);
	});

	it("builds the expected tree from a test run", async () => {
		await openFile(helloWorldTestTreeFile);
		const config = await startDebugger(helloWorldTestTreeFile);
		config.noDebug = true;
		await Promise.all([
			dc.configurationSequence(),
			dc.waitForEvent("terminated"),
			dc.launch(config),
		]);

		const expectedResults = getExpectedResults();
		const actualResults = makeTextTree(helloWorldTestTreeFile, extApi.testTreeProvider).join("\n");

		assert.ok(expectedResults);
		assert.ok(actualResults);
		assert.equal(actualResults, expectedResults);
	});

	it("sorts suites correctly", async () => {
		// Run each test file in a different order to how we expect the results.
		for (const file of [helloWorldTestSkipFile, helloWorldTestMainFile, helloWorldTestTreeFile, helloWorldTestBrokenFile]) {
			await openFile(file);
			const config = await startDebugger(file);
			config.noDebug = true;
			await Promise.all([
				dc.configurationSequence(),
				dc.waitForEvent("terminated"),
				dc.launch(config),
			]);
		}

		const topLevelNodes = extApi.testTreeProvider.getChildren();
		assert.ok(topLevelNodes);
		assert.equal(topLevelNodes.length, 4);

		assert.equal(`${topLevelNodes[0].label} (${TestStatus[topLevelNodes[0].status]})`, "broken_test.dart (Failed)");
		assert.equal(`${topLevelNodes[1].label} (${TestStatus[topLevelNodes[1].status]})`, "tree_test.dart (Failed)");
		assert.equal(`${topLevelNodes[2].label} (${TestStatus[topLevelNodes[2].status]})`, "basic_test.dart (Passed)");
		assert.equal(`${topLevelNodes[3].label} (${TestStatus[topLevelNodes[3].status]})`, "skip_test.dart (Skipped)");
	});

	it("does not overwrite unrelated test nodes due to overlapping IDs", async () => {
		// When we run an individual test, it will always have an ID of 1. Since the test we ran might
		// not have been ID=1 in the previous run, we need to be sure we update the correct node in the tree.
		// To test it, we'll run the whole suite, ensure the results are as expected, and then re-check it
		// after running each test individually.

		function checkResults(description: string) {
			log(description);
			const expectedResults = getExpectedResults();
			const actualResults = makeTextTree(helloWorldTestTreeFile, extApi.testTreeProvider).join("\n");

			assert.ok(expectedResults);
			assert.ok(actualResults);
			assert.equal(actualResults, expectedResults);
		}

		await runWithoutDebugging(helloWorldTestTreeFile);
		let numRuns = 1;
		checkResults(`After initial run`);
		const visitor = new TestOutlineVisitor();
		visitor.visit(OpenFileTracker.getOutlineFor(helloWorldTestTreeFile));
		for (const test of visitor.tests.filter((t) => !t.isGroup)) {
			// Run the test.
			await runWithoutDebugging(helloWorldTestTreeFile, ["--name", makeRegexForTest(test.fullName, test.isGroup)]);
			checkResults(`After running ${numRuns++} tests (most recently ${test.fullName})`);
		}
	});

	it.skip("removes stale results when running a full suite", () => {
		// Need to rename a test or something to ensure we get a stale result
		// after a full suite run?
	});

	async function runWithoutDebugging(file: vs.Uri, args?: string[]): Promise<void> {
		await openFile(file);
		const config = await startDebugger(file, { args, noDebug: true });
		await Promise.all([
			dc.configurationSequence(),
			dc.waitForEvent("terminated"),
			dc.launch(config),
		]);
	}
});
function makeTextTree(suite: vs.Uri, provider: TestResultsProvider, parent?: vs.TreeItem, buffer: string[] = [], indent = 0) {
	const items = provider.getChildren(parent)
		// Filter to only the suite we were given (though includes all children).
		.filter((item) => fsPath(item.resourceUri) === fsPath(suite) || !!parent);
	items.forEach((item) => {
		buffer.push(`${" ".repeat(indent * 4)}${item.label} (${TestStatus[item.status]})`);
		makeTextTree(suite, provider, item, buffer, indent + 1);
	});
	return buffer;
}
