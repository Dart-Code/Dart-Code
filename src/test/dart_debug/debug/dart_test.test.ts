import * as assert from "assert";
import * as vs from "vscode";
import { DebuggerType, TestStatus } from "../../../shared/enums";
import { SuiteNode } from "../../../shared/test/test_model";
import { fsPath } from "../../../shared/utils/fs";
import { DasTestOutlineInfo, TestOutlineVisitor } from "../../../shared/utils/outline_das";
import { LspTestOutlineInfo, LspTestOutlineVisitor } from "../../../shared/utils/outline_lsp";
import * as testUtils from "../../../shared/utils/test";
import { DartDebugClient } from "../../dart_debug_client";
import { createDebugClient, expectTopLevelTestNodeCount, startDebugger, waitAllThrowIfTerminates } from "../../debug_helpers";
import { activate, captureDebugSessionCustomEvents, delay, extApi, getCodeLens, getExpectedResults, getPackages, getResolvedDebugConfiguration, helloWorldTestBrokenFile, helloWorldTestDupeNameFile, helloWorldTestMainFile, helloWorldTestShortFile, helloWorldTestSkipFile, helloWorldTestTreeFile, logger, makeTextTree, openFile, positionOf, setConfigForTest, waitForResult } from "../../helpers";

describe("dart test debugger", () => {
	// We have tests that require external packages.
	before("get packages", () => getPackages());
	beforeEach("clear test tree", async () => {
		for (const key of Object.keys(extApi.testTreeModel.suites))
			delete extApi.testTreeModel.suites[key];
		extApi.testTreeModel.isNewTestRun = true;
		extApi.testTreeModel.nextFailureIsFirst = true;
		extApi.testTreeModel.updateNode();
		await delay(10); // Allow tree to be updated.
	});
	beforeEach("activate", () => activate(null));

	let dc: DartDebugClient;
	beforeEach("create debug client", () => {
		dc = createDebugClient(DebuggerType.PubTest);
	});

	it("runs a Dart test script to completion", async () => {
		await openFile(helloWorldTestMainFile);
		const config = await startDebugger(dc, helloWorldTestMainFile);
		await waitAllThrowIfTerminates(dc,
			dc.configurationSequence(),
			dc.waitForEvent("terminated"),
			dc.launch(config),
		);
	});

	it("can run tests from codelens", async function () {
		const editor = await openFile(helloWorldTestMainFile);
		await waitForResult(() => !!extApi.fileTracker.getOutlineFor(helloWorldTestMainFile));

		const fileCodeLens = await getCodeLens(editor.document);
		const testPos = positionOf(`test^(".split() splits`);

		const codeLensForTest = fileCodeLens.filter((cl) => cl.range.start.line === testPos.line);
		assert.equal(codeLensForTest.length, 2);

		if (!codeLensForTest[0].command) {
			// If there's no command, skip the test. This happens very infrequently and appears to be a VS Code
			// race condition. Rather than failing our test runs, skip.
			// TODO: Remove this if https://github.com/microsoft/vscode/issues/79805 gets a reliable fix.
			this.skip();
			return;
		}

		const runAction = codeLensForTest.find((cl) => cl.command!.title === "Run")!;
		assert.equal(runAction.command!.command, "_dart.startWithoutDebuggingTestFromOutline");
		assert.equal(runAction.command!.arguments![0].fullName, "String .split() splits the string on the delimiter");
		assert.equal(runAction.command!.arguments![0].isGroup, false);

		const customEvents = await captureDebugSessionCustomEvents(async () => {
			const didStart = await vs.commands.executeCommand(runAction.command!.command, ...(runAction.command!.arguments ?? []));
			assert.ok(didStart);
		});
		// Ensure we got at least a "testDone" notification so we know the test run started correctly.
		const testDoneNotification = customEvents.find((e) => e.event === "dart.testRunNotification" && e.body.notification.type === "testDone");
		assert.ok(testDoneNotification, JSON.stringify(customEvents.map((e) => e.body), undefined, 4));
	});

	it("receives the expected events from a Dart test script", async () => {
		await openFile(helloWorldTestMainFile);
		const config = await startDebugger(dc, helloWorldTestMainFile);
		await waitAllThrowIfTerminates(dc,
			dc.configurationSequence(),
			dc.assertOutput("stdout", `✓ String .split() splits the string on the delimiter`),
			dc.assertPassingTest("String .split() splits the string on the delimiter"),
			dc.waitForEvent("terminated"),
			dc.launch(config),
		);
	});

	it("stops at a breakpoint", async () => {
		await openFile(helloWorldTestMainFile);
		const config = await startDebugger(dc, helloWorldTestMainFile);
		await dc.hitBreakpoint(config, {
			line: positionOf("^// BREAKPOINT1").line + 1, // positionOf is 0-based, but seems to want 1-based
			path: fsPath(helloWorldTestMainFile),
		});
	});

	it("stops on exception", async () => {
		await openFile(helloWorldTestBrokenFile);
		const config = await startDebugger(dc, helloWorldTestBrokenFile);
		await waitAllThrowIfTerminates(dc,
			dc.configurationSequence(),
			dc.assertStoppedLocation("exception", {}),
			dc.launch(config),
		);
	});

	it.skip("stops at the correct location on exception", async () => {
		// TODO: Check the expected location is in the call stack, and that the frames above it are all marked
		// as deemphasized.
		await openFile(helloWorldTestBrokenFile);
		const config = await startDebugger(dc, helloWorldTestBrokenFile);
		await waitAllThrowIfTerminates(dc,
			dc.configurationSequence(),
			dc.assertStoppedLocation("exception", {
				line: positionOf("^expect(1, equals(2))").line + 1, // positionOf is 0-based, but seems to want 1-based
				path: fsPath(helloWorldTestBrokenFile),
			}),
			dc.launch(config),
		);
	});

	it("provides exception details when stopped on exception", async () => {
		await openFile(helloWorldTestBrokenFile);
		const config = await startDebugger(dc, helloWorldTestBrokenFile);
		await waitAllThrowIfTerminates(dc,
			dc.configurationSequence(),
			dc.assertStoppedLocation("exception", {}),
			dc.launch(config),
		);

		const variables = await dc.getTopFrameVariables("Exception");
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
		const config = await startDebugger(dc, helloWorldTestBrokenFile);
		config.noDebug = true;
		await waitAllThrowIfTerminates(dc,
			dc.configurationSequence(),
			dc.assertFailingTest("might fail today"),
			dc.assertOutput("stderr", `Expected: <2>\n  Actual: <1>`),
			dc.launch(config),
		);
	});

	it("builds the expected tree from a test run", async () => {
		await openFile(helloWorldTestTreeFile);
		const config = await startDebugger(dc, helloWorldTestTreeFile);
		config.noDebug = true;
		await waitAllThrowIfTerminates(dc,
			dc.configurationSequence(),
			dc.waitForEvent("terminated"),
			dc.launch(config),
		);

		const expectedResults = getExpectedResults();
		const actualResults = (await makeTextTree(helloWorldTestTreeFile, extApi.testTreeProvider)).join("\n");

		assert.ok(expectedResults);
		assert.ok(actualResults);
		assert.equal(actualResults, expectedResults);
	});

	it("clears the results from the test tree", async () => {
		await openFile(helloWorldTestTreeFile);
		const config = await startDebugger(dc, helloWorldTestTreeFile);
		config.noDebug = true;
		await waitAllThrowIfTerminates(dc,
			dc.configurationSequence(),
			dc.waitForEvent("terminated"),
			dc.launch(config),
		);

		const preclearActualResults = await extApi.testTreeProvider.getChildren();
		assert.ok(preclearActualResults && preclearActualResults.length >= 1, "There should be at least one test item to ensure the tree was actually cleared");

		await vs.commands.executeCommand("dart.clearTestResults");

		const actualResults = await extApi.testTreeProvider.getChildren();
		assert.strictEqual(actualResults?.length, 0);
	});

	it("builds the expected tree if tests are run in multiple overlapping sessions", async () => {
		// https://github.com/Dart-Code/Dart-Code/issues/2934
		await openFile(helloWorldTestShortFile);
		const runTests = async () => {
			// Create separate debug clients for each run, else we'll send multiple
			// launchRequests to the same one.
			const testDc = createDebugClient(DebuggerType.PubTest);
			const config = await startDebugger(testDc, helloWorldTestShortFile);
			config.noDebug = true;
			await waitAllThrowIfTerminates(testDc,
				testDc.configurationSequence(),
				testDc.waitForEvent("terminated"),
				testDc.launch(config),
			);
		};
		await Promise.all([
			runTests(),
			runTests(),
		]);

		const expectedResults = getExpectedResults();
		const actualResults = (await makeTextTree(helloWorldTestShortFile, extApi.testTreeProvider)).join("\n");

		assert.ok(expectedResults);
		assert.ok(actualResults);
		assert.strictEqual(actualResults, expectedResults);
	});

	it("warns if multiple tests run when one was expected", async () => {
		await openFile(helloWorldTestDupeNameFile);
		const config = await getResolvedDebugConfiguration(testUtils.getLaunchConfig(true, fsPath(helloWorldTestDupeNameFile), ["group test"], false));
		await dc.start();
		await waitAllThrowIfTerminates(dc,
			dc.configurationSequence(),
			dc.assertOutputContains("console", "You may have multiple tests with the same name"),
			dc.waitForEvent("terminated"),
			dc.launch(config),
		);
	});

	it("sorts suites correctly", async () => {
		// Run each test file in a different order to how we expect the results.
		for (const file of [helloWorldTestSkipFile, helloWorldTestMainFile, helloWorldTestTreeFile, helloWorldTestBrokenFile]) {
			const config = await startDebugger(dc, file);
			config.noDebug = true;
			await waitAllThrowIfTerminates(dc,
				dc.configurationSequence(),
				dc.waitForEvent("terminated"),
				dc.launch(config),
			);
		}

		const topLevelNodes = await extApi.testTreeProvider.getChildren() as SuiteNode[];
		assert.ok(topLevelNodes);
		expectTopLevelTestNodeCount(topLevelNodes, 4);

		let actualOrder = "";
		for (const node of topLevelNodes) {
			const treeItem = await extApi.testTreeProvider.getTreeItem(node);
			actualOrder += `${treeItem.resourceUri!.toString()} (${TestStatus[node.getHighestStatus(true)]} / ${TestStatus[node.getHighestStatus(false)]})\n`;
		}

		const expectedOrder = `
${helloWorldTestBrokenFile} (Failed / Failed)
${helloWorldTestTreeFile} (Failed / Failed)
${helloWorldTestMainFile} (Passed / Passed)
${helloWorldTestSkipFile} (Skipped / Skipped)
		`;

		assert.strictEqual(actualOrder.trim(), expectedOrder.trim());
	});

	it("runs all tests if given a folder", async () => {
		const config = await startDebugger(dc, "./test/");
		config.noDebug = true;
		await waitAllThrowIfTerminates(dc,
			dc.configurationSequence(),
			dc.waitForEvent("terminated"),
			dc.launch(config),
		);

		const topLevelNodes = await extApi.testTreeProvider.getChildren();
		assert.ok(topLevelNodes);
		expectTopLevelTestNodeCount(topLevelNodes, 7);
	});

	it("does not overwrite unrelated test nodes due to overlapping IDs", async () => {
		// When we run an individual test, it will always have an ID of 1. Since the test we ran might
		// not have been ID=1 in the previous run, we need to be sure we update the correct node in the tree.
		// To test it, we'll run the whole suite, ensure the results are as expected, and then re-check it
		// after running each test individually.

		async function checkResults(description: string): Promise<void> {
			logger.info(description);
			const expectedResults = getExpectedResults();
			const actualResults = (await makeTextTree(helloWorldTestTreeFile, extApi.testTreeProvider)).join("\n");

			assert.ok(expectedResults);
			assert.ok(actualResults);
			assert.equal(actualResults, expectedResults);
		}

		await runWithoutDebugging(helloWorldTestTreeFile);
		let numRuns = 1;
		await checkResults(`After initial run`);
		const visitor = extApi.isLsp ? new LspTestOutlineVisitor(logger, fsPath(helloWorldTestTreeFile)) : new TestOutlineVisitor(logger);
		const outline = extApi.fileTracker.getOutlineFor(helloWorldTestTreeFile);
		if (!outline)
			throw new Error(`Did not get outline for ${helloWorldTestTreeFile}`);
		visitor.visit(outline as any); // TODO: Remove when we don't have two outlines
		for (const test of (visitor.tests as Array<LspTestOutlineInfo | DasTestOutlineInfo>).filter((t) => !t.isGroup)) {
			// Run the test.
			await runWithoutDebugging(
				helloWorldTestTreeFile,
				["--name", testUtils.makeRegexForTests([test.fullName], test.isGroup)],
				// Ensure the output contained the test name as a sanity check
				// that it ran. Because some tests have variables added to the
				// end, just stop at the $ to avoid failing on them.
				dc.assertOutputContains("stdout", test.fullName.split("$")[0]),
			);
			await checkResults(`After running ${numRuns++} tests (most recently ${test.fullName})`);
		}
	});

	it("merges same name groups but not tests from the same run", async () => {
		// This test is similar to above but contains adjacent tests with the same name.
		// In a single run the tests must not be merged (groups are ok). When individual tests
		// are re-run we may re-use nodes, but always pick the closest one (source line number)
		// and only never a node that's already been "claimed" by the current run.
		// We re-run the groups as well as tests, to ensure consistent results when running
		// multiple of the duplicated tests.

		async function checkResults(description: string): Promise<void> {
			logger.info(description);
			const expectedResults = getExpectedResults();
			const actualResults = (await makeTextTree(helloWorldTestDupeNameFile, extApi.testTreeProvider)).join("\n");

			assert.ok(expectedResults);
			assert.ok(actualResults);
			assert.equal(actualResults, expectedResults);
		}

		await runWithoutDebugging(helloWorldTestDupeNameFile);
		let numRuns = 1;
		await checkResults(`After initial run`);
		const visitor = new TestOutlineVisitor(logger);
		const outline = extApi.fileTracker.getOutlineFor(helloWorldTestDupeNameFile);
		if (!outline)
			throw new Error(`Did not get outline for ${helloWorldTestDupeNameFile}`);
		visitor.visit(outline as any); // TODO: Remove when we don't have two outlines
		const doc = await vs.workspace.openTextDocument(helloWorldTestDupeNameFile);
		const editor = await vs.window.showTextDocument(doc);
		for (const modifyFile of [false, true]) {
			// We'll run all this twice, once without modifying the file and then with new lines inserted (to
			// shift the line)
			if (modifyFile)
				await editor.edit((e) => e.insert(doc.positionAt(0), "// These\n// are\n// inserted\n// lines.\n\n"));
			// Re-run each test.
			for (const test of visitor.tests.filter((t) => !t.isGroup)) {
				await runWithoutDebugging(helloWorldTestDupeNameFile, ["--name", testUtils.makeRegexForTests([test.fullName], test.isGroup)]);
				await checkResults(`After running ${numRuns++} tests (most recently the test: ${test.fullName})`);
			}
			// Re-run each group.
			for (const group of visitor.tests.filter((t) => t.isGroup)) {
				await runWithoutDebugging(helloWorldTestDupeNameFile, ["--name", testUtils.makeRegexForTests([group.fullName], group.isGroup)]);
				await checkResults(`After running ${numRuns++} groups (most recently the group: ${group.fullName})`);
			}
		}
	}).timeout(160000); // This test runs lots of tests, and they're quite slow to start up currently.

	it("can rerun only skipped tests", async () => {
		await openFile(helloWorldTestTreeFile);
		const config = await startDebugger(dc, helloWorldTestTreeFile);
		config.noDebug = true;
		await waitAllThrowIfTerminates(dc,
			dc.configurationSequence(),
			dc.waitForEvent("terminated"),
			dc.launch(config),
		);

		// Now run only skipped tests.
		await vs.commands.executeCommand("dart.runAllSkippedTestsWithoutDebugging");

		await openFile(helloWorldTestTreeFile);
		// Expected results differ from what's in the file as the skipped tests will be run
		// and also the parent groups/suite status will be recomputed so they will be not-stale
		// in the new results (so we can't just filter to skipped, like we do in the failed test).
		const expectedResults = `
test/tree_test.dart [8/11 passed, {duration}ms] (fail.svg)
    failing group 1 [3/4 passed, {duration}ms] (fail.svg)
        skipped test 1 some string [{duration}ms] (pass.svg)
    skipped group 2 [4/6 passed, {duration}ms] (fail.svg)
        skipped group 2.1 [2/3 passed, {duration}ms] (fail.svg)
            passing test 1 [{duration}ms] (pass.svg)
            failing test 1 [{duration}ms] (fail.svg)
            skipped test 1 [{duration}ms] (pass.svg)
        skipped test 1 [{duration}ms] (pass.svg)
		`.trim();

		// Get the actual tree, filtered only to those that ran in the last run.
		const actualResults = (await makeTextTree(helloWorldTestTreeFile, extApi.testTreeProvider, { onlyActive: true })).join("\n");
		assert.strictEqual(actualResults, expectedResults);
	});

	it("can rerun only failed tests", async () => {
		const testFiles = [helloWorldTestTreeFile, helloWorldTestBrokenFile];
		for (const file of testFiles) {
			await openFile(file);
			const config = await startDebugger(dc, file);
			config.noDebug = true;
			await waitAllThrowIfTerminates(dc,
				dc.configurationSequence(),
				dc.waitForEvent("terminated"),
				dc.launch(config),
			);
		}

		// Now run only failed tests.
		await vs.commands.executeCommand("dart.runAllFailedTestsWithoutDebugging");

		for (const file of testFiles) {
			await openFile(file);
			// Get the expected tree and filter it to only failed tests.
			const expectedResults = getExpectedResults().split("\n").filter((l) => l.includes("fail.svg")).join("\n");
			// Get the actual tree, filtered only to those that ran in the last run.
			const actualResults = (await makeTextTree(file, extApi.testTreeProvider, { onlyActive: true })).join("\n");
			assert.strictEqual(actualResults, expectedResults);
		}
	});

	it("can hide skipped tests from tree", async () => {
		await openFile(helloWorldTestTreeFile);
		const config = await startDebugger(dc, helloWorldTestTreeFile);
		config.noDebug = true;
		await waitAllThrowIfTerminates(dc,
			dc.configurationSequence(),
			dc.waitForEvent("terminated"),
			dc.launch(config),
		);

		// First ensure the full results appear.
		let expectedResults = getExpectedResults();
		let actualResults = (await makeTextTree(helloWorldTestTreeFile, extApi.testTreeProvider)).join("\n");
		assert.ok(actualResults);
		assert.strictEqual(actualResults, expectedResults);

		// Check toggling the setting results in the skipped nodes being removed.
		await setConfigForTest("dart", "showSkippedTests", false);
		// Expected results differ from what's in the file not only because skipped tests are hidden, but because
		// the counts on the containing nodes will also be reduced.
		expectedResults = `
test/tree_test.dart [4/6 passed, {duration}ms] (fail.svg)
    failing group 1 [2/3 passed, {duration}ms] (fail.svg)
        group 1.1 [1/1 passed, {duration}ms] (pass.svg)
            passing test 1 with ' some " quotes and newlines in name [{duration}ms] (pass.svg)
        passing test 1 2 [{duration}ms] (pass.svg)
        failing test 1 some string [{duration}ms] (fail.svg)
    skipped group 2 [1/2 passed, {duration}ms] (fail.svg)
        passing test 1 [{duration}ms] (pass.svg)
        failing test 1 [{duration}ms] (fail.svg)
    passing group 3 [1/1 passed, {duration}ms] (pass.svg)
        passing test 1 [{duration}ms] (pass.svg)
		`.trim();
		actualResults = (await makeTextTree(helloWorldTestTreeFile, extApi.testTreeProvider)).join("\n");
		assert.ok(actualResults);
		assert.strictEqual(actualResults, expectedResults);
	});

	it.skip("removes stale results when running a full suite", () => {
		// Need to rename a test or something to ensure we get a stale result
		// after a full suite run?
	});

	async function runWithoutDebugging(file: vs.Uri, args?: string[], ...otherEvents: Array<Promise<any>>): Promise<void> {
		await openFile(file);
		const config = await startDebugger(dc, file, { args, noDebug: true });
		await waitAllThrowIfTerminates(dc,
			dc.configurationSequence(),
			dc.waitForEvent("terminated"),
			...otherEvents,
			dc.launch(config),
		);
	}
});
