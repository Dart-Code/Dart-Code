import * as assert from "assert";
import * as path from "path";
import * as vs from "vscode";
import { DebugProtocol } from "vscode-debugprotocol";
import { OpenFileTracker } from "../../../extension/analysis/open_file_tracker";
import { log, logInfo } from "../../../extension/utils/log";
import { makeRegexForTest } from "../../../extension/utils/test";
import { TestOutlineVisitor } from "../../../extension/utils/vscode/outline";
import { TestStatus } from "../../../shared/enums";
import { fsPath } from "../../../shared/vscode/utils";
import { DartDebugClient } from "../../dart_debug_client";
import { activate, defer, delay, ext, extApi, getExpectedResults, getLaunchConfiguration, getPackages, helloWorldTestBrokenFile, helloWorldTestDupeNameFile, helloWorldTestMainFile, helloWorldTestSkipFile, helloWorldTestTreeFile, makeTextTree, openFile, positionOf, withTimeout } from "../../helpers";

describe("dart test debugger", () => {
	// We have tests that require external packages.
	before("get packages", () => getPackages());
	beforeEach("activate helloWorldTestMainFile", () => activate(helloWorldTestMainFile));

	let dc: DartDebugClient;
	beforeEach("create debug client", () => {
		dc = new DartDebugClient(
			process.execPath,
			path.join(ext.extensionPath, "out/extension/debug/dart_test_debug_entry.js"),
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

	async function startDebugger(script: vs.Uri | string, extraConfiguration?: { [key: string]: any }): Promise<vs.DebugConfiguration | undefined | null> {
		const config = await getLaunchConfiguration(script, extraConfiguration);
		if (!config)
			throw new Error(`Could not get launch configuration (got ${config})`);
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

	it("stops on exception", async () => {
		await openFile(helloWorldTestBrokenFile);
		const config = await startDebugger(helloWorldTestBrokenFile);
		await Promise.all([
			dc.configurationSequence(),
			dc.assertStoppedLocation("exception", {}),
			dc.launch(config),
		]);
	});

	it.skip("stops at the correct location on exception", async () => {
		// TODO: Check the expected location is in the call stack, and that the frames above it are all marked
		// as deemphasized.
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

	it.skip("provides exception details when stopped on exception", async () => {
		await openFile(helloWorldTestBrokenFile);
		const config = await startDebugger(helloWorldTestBrokenFile);
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
		config!.noDebug = true;
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
		config!.noDebug = true;
		await Promise.all([
			dc.configurationSequence(),
			dc.waitForEvent("terminated"),
			dc.launch(config),
		]);

		const expectedResults = getExpectedResults();
		const actualResults = (await makeTextTree(helloWorldTestTreeFile, extApi.testTreeProvider)).join("\n");

		assert.ok(expectedResults);
		assert.ok(actualResults);
		assert.equal(actualResults, expectedResults);
	});

	it("sorts suites correctly", async () => {
		// Run each test file in a different order to how we expect the results.
		for (const file of [helloWorldTestSkipFile, helloWorldTestMainFile, helloWorldTestTreeFile, helloWorldTestBrokenFile]) {
			await openFile(file);
			const config = await startDebugger(file);
			config!.noDebug = true;
			await Promise.all([
				dc.configurationSequence(),
				dc.waitForEvent("terminated"),
				dc.launch(config),
			]);
		}

		const topLevelNodes = await extApi.testTreeProvider.getChildren();
		assert.ok(topLevelNodes);
		assert.equal(topLevelNodes.length, 4);

		assert.equal(topLevelNodes[0].resourceUri!.toString(), helloWorldTestBrokenFile.toString());
		assert.equal(topLevelNodes[0].status, TestStatus.Failed);
		assert.equal(topLevelNodes[1].resourceUri!.toString(), helloWorldTestTreeFile.toString());
		assert.equal(topLevelNodes[1].status, TestStatus.Failed);
		assert.equal(topLevelNodes[2].resourceUri!.toString(), helloWorldTestMainFile.toString());
		assert.equal(topLevelNodes[2].status, TestStatus.Passed);
		assert.equal(topLevelNodes[3].resourceUri!.toString(), helloWorldTestSkipFile.toString());
		assert.equal(topLevelNodes[3].status, TestStatus.Skipped);
	});

	it("runs all tests if given a folder", async () => {
		const config = await startDebugger("./test/");
		config!.noDebug = true;
		await Promise.all([
			dc.configurationSequence(),
			dc.waitForEvent("terminated"),
			dc.launch(config),
		]);

		const topLevelNodes = await extApi.testTreeProvider.getChildren();
		assert.ok(topLevelNodes);
		assert.equal(topLevelNodes.length, 5);
	});

	it("does not overwrite unrelated test nodes due to overlapping IDs", async () => {
		// When we run an individual test, it will always have an ID of 1. Since the test we ran might
		// not have been ID=1 in the previous run, we need to be sure we update the correct node in the tree.
		// To test it, we'll run the whole suite, ensure the results are as expected, and then re-check it
		// after running each test individually.

		async function checkResults(description: string): Promise<void> {
			log(description);
			const expectedResults = getExpectedResults();
			const actualResults = (await makeTextTree(helloWorldTestTreeFile, extApi.testTreeProvider)).join("\n");

			assert.ok(expectedResults);
			assert.ok(actualResults);
			assert.equal(actualResults, expectedResults);
		}

		await runWithoutDebugging(helloWorldTestTreeFile);
		let numRuns = 1;
		await checkResults(`After initial run`);
		const visitor = new TestOutlineVisitor();
		const outline = OpenFileTracker.getOutlineFor(helloWorldTestTreeFile);
		if (!outline)
			throw new Error(`Did not get outline for ${helloWorldTestTreeFile}`);
		visitor.visit(outline);
		for (const test of visitor.tests.filter((t) => !t.isGroup)) {
			// Run the test.
			await runWithoutDebugging(helloWorldTestTreeFile, ["--name", makeRegexForTest(test.fullName, test.isGroup)]);
			await checkResults(`After running ${numRuns++} tests (most recently ${test.fullName})`);
		}
	}).timeout(180000); // This test runs lots of tests, and they're quite slow to start up currently.

	it("merges same name groups but not tests from the same run", async () => {
		// This test is similar to above but contains adjacent tests with the same name.
		// In a single run the tests must not be merged (groups are ok). When individual tests
		// are re-run we may re-use nodes, but always pick the cloest one (source line number)
		// and only never a node that's already been "claimed" by the current run.
		// We re-run the groups as well as tests, to ensure consistent results when running
		// multiple of the duplicated tests.

		async function checkResults(description: string): Promise<void> {
			log(description);
			const expectedResults = getExpectedResults();
			const actualResults = (await makeTextTree(helloWorldTestDupeNameFile, extApi.testTreeProvider)).join("\n");

			assert.ok(expectedResults);
			assert.ok(actualResults);
			assert.equal(actualResults, expectedResults);
		}

		await runWithoutDebugging(helloWorldTestDupeNameFile);
		let numRuns = 1;
		await checkResults(`After initial run`);
		const visitor = new TestOutlineVisitor();
		const outline = OpenFileTracker.getOutlineFor(helloWorldTestDupeNameFile);
		if (!outline)
			throw new Error(`Did not get outline for ${helloWorldTestDupeNameFile}`);
		visitor.visit(outline);
		const doc = await vs.workspace.openTextDocument(helloWorldTestDupeNameFile);
		const editor = await vs.window.showTextDocument(doc);
		for (const modifyFile of [false, true]) {
			// We'll run all this twice, once without modifying the file and then with new lines inserted (to
			// shift the line)
			if (modifyFile)
				await editor.edit((e) => e.insert(doc.positionAt(0), "// These\n// are\n// inserted\n// lines.\n\n"));
			// Re-run each test.
			for (const test of visitor.tests.filter((t) => !t.isGroup)) {
				await runWithoutDebugging(helloWorldTestDupeNameFile, ["--name", makeRegexForTest(test.fullName, test.isGroup)]);
				await checkResults(`After running ${numRuns++} tests (most recently the test: ${test.fullName})`);
			}
			// Re-run each group.
			for (const group of visitor.tests.filter((t) => t.isGroup)) {
				await runWithoutDebugging(helloWorldTestDupeNameFile, ["--name", makeRegexForTest(group.fullName, group.isGroup)]);
				await checkResults(`After running ${numRuns++} groups (most recently the group: ${group.fullName})`);
			}
		}
	}).timeout(160000); // This test runs lots of tests, and they're quite slow to start up currently.

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
