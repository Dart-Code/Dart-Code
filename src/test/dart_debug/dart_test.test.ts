import { strict as assert } from "assert";
import { writeFileSync } from "fs";
import * as path from "path";
import * as vs from "vscode";
import { URI } from "vscode-uri";
import { DebuggerType } from "../../shared/enums";
import { getPackageTestCapabilities } from "../../shared/test/version";
import { SuiteNotification, TestStartNotification } from "../../shared/test_protocol";
import { fsPath } from "../../shared/utils/fs";
import { TestOutlineVisitor } from "../../shared/utils/outline";
import { waitFor } from "../../shared/utils/promises";
import * as testUtils from "../../shared/utils/test";
import { DartDebugClient } from "../dart_debug_client";
import { createDebugClient, startDebugger, waitAllThrowIfTerminates } from "../debug_helpers";
import { activateWithoutAnalysis, captureDebugSessionCustomEvents, checkTreeNodeResults, clearTestTree, currentEditor, customScriptExt, delay, ensureArrayContainsArray, ensureHasRunWithArgsStarting, fakeCancellationToken, getCodeLens, getExpectedResults, getPackages, getResolvedDebugConfiguration, helloWorldExampleSubFolderProjectTestFile, helloWorldFolder, helloWorldProjectTestFile, helloWorldTestBrokenFile, helloWorldTestDupeNameFile, helloWorldTestDynamicFile, helloWorldTestEmptyFile, helloWorldTestEnvironmentFile, helloWorldTestMainFile, helloWorldTestSelective1File, helloWorldTestSelective2File, helloWorldTestShortFile, helloWorldTestTreeFile, isTestDoneSuccessNotification, logger, makeTestTextTree, openFile as openFileBasic, positionOf, prepareHasRunFile, privateApi, setConfigForTest, setTestContent, waitForResult } from "../helpers";

describe("dart test debugger", () => {
	// We have tests that require external packages.
	before("get packages", () => getPackages());
	beforeEach("activate", () => activateWithoutAnalysis(null));

	let dc: DartDebugClient;
	let consoleOutputCategory: string;
	beforeEach("create debug client", () => {
		dc = createDebugClient(DebuggerType.DartTest);
		consoleOutputCategory = dc.isDartDap ? "console" : "stdout";
	});

	beforeEach("clear test tree", () => clearTestTree());

	/// Wrap openFile to force test discovery to re-run since we clear the test
	/// tree state between tests, but some tests rely on the Outline-populated test
	/// nodes to verify trees.
	async function openFile(file: vs.Uri): Promise<vs.TextEditor> {
		const editor = await openFileBasic(file);
		privateApi.testDiscoverer?.forceUpdate(file);
		return editor;
	}

	describe("resolves the correct debug config", () => {
		it("passing launch.json's toolArgs to the VM", async () => {
			const resolvedConfig = await getResolvedDebugConfiguration({
				program: fsPath(helloWorldTestMainFile),
				toolArgs: ["--fake-flag"],
			});

			assert.ok(resolvedConfig);
			assert.equal(resolvedConfig.program, fsPath(helloWorldTestMainFile));
			assert.equal(resolvedConfig.cwd, fsPath(helloWorldFolder));
			ensureArrayContainsArray(resolvedConfig.toolArgs!, ["--fake-flag"]);
		});

		it("when testAdditionalArgs is set", async () => {
			await setConfigForTest("dart", "testAdditionalArgs", ["--my-test-flag"]);
			const resolvedConfig = await getResolvedDebugConfiguration({
				program: fsPath(helloWorldTestMainFile),
			});

			ensureArrayContainsArray(resolvedConfig.toolArgs!, ["--my-test-flag"]);
		});

		it("when suppressTestTimeouts is set", async () => {
			await setConfigForTest("dart", "suppressTestTimeouts", "always");
			const resolvedConfig = await getResolvedDebugConfiguration({
				program: fsPath(helloWorldTestMainFile),
			});

			const testCapabilities = await getPackageTestCapabilities(privateApi.logger, privateApi.workspaceContext, resolvedConfig.cwd!);
			if (testCapabilities.supportsIgnoreTimeouts)
				ensureArrayContainsArray(resolvedConfig.toolArgs!, ["--ignore-timeouts"]);
			else
				ensureArrayContainsArray(resolvedConfig.toolArgs!, ["--timeout"]);
		});
	});

	for (const runByLine of [false, true]) {
		describe(`when running tests by ${runByLine ? "line" : "name"}`, () => {
			beforeEach("set config.testInvocationMode", async () => {
				await setConfigForTest("dart", "testInvocationMode", runByLine ? "line" : "name");
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

			it("can run tests from codelens", async () => {
				const search = `test^(".split() splits`;
				const testName = "String .split() splits the string on the delimiter";

				await checkRunSingleTestFromCodeLens(helloWorldTestMainFile, search, testName);
			});

			it("can run tests from codelens with greater than", async () => {
				const search = `test^("without quotes List<String>`;
				const testName = "greater than without quotes List<String>";

				await checkRunSingleTestFromCodeLens(helloWorldTestMainFile, search, testName);
			});

			it("can run tests from codelens with greater than after quote", async () => {
				const search = `test^('with quotes ">= foo`;
				const testName = `greater than with quotes ">= foo"`;

				await checkRunSingleTestFromCodeLens(helloWorldTestMainFile, search, testName);
			});

			it("can run tests from codelens with backticks", async () => {
				const search = `test^('\`with backticks`;
				const testName = "`with backticks`";

				await checkRunSingleTestFromCodeLens(helloWorldTestMainFile, search, testName);
			});

			it("can run using a custom tool", async () => {
				const root = fsPath(helloWorldFolder);
				const hasRunFile = prepareHasRunFile(root, "dart_test");

				const config = await startDebugger(dc, helloWorldTestMainFile, {
					customTool: path.join(root, `scripts/custom_test.${customScriptExt}`),
					// Replace "run --no-spawn-devtools test:test"
					customToolReplacesArgs: 3,
					enableAsserts: false,
					noDebug: true,
				});
				await waitAllThrowIfTerminates(dc,
					dc.configurationSequence(),
					dc.waitForEvent("terminated"),
					dc.launch(config),
				);

				ensureHasRunWithArgsStarting(root, hasRunFile, `-r json`);
			});

			it("can replace all args using custom tool", async () => {
				const root = fsPath(helloWorldFolder);
				const hasRunFile = prepareHasRunFile(root, "dart_test");

				const config = await startDebugger(dc, helloWorldTestMainFile, {
					customTool: path.join(root, `scripts/custom_test.${customScriptExt}`),
					customToolReplacesArgs: 999999,
					enableAsserts: false,
					noDebug: true,
					// These differ to the usual ones so we can detect they replaced them.
					toolArgs: ["-j2", "-r", "json"],
				});
				await waitAllThrowIfTerminates(dc,
					dc.configurationSequence(),
					dc.waitForEvent("terminated"),
					dc.launch(config),
				);

				ensureHasRunWithArgsStarting(root, hasRunFile, `-j2 -r json`);
			});

			it("receives the expected events from a Dart test script", async () => {
				await openFile(helloWorldTestMainFile);
				const config = await startDebugger(dc, helloWorldTestMainFile);
				await waitAllThrowIfTerminates(dc,
					dc.configurationSequence(),
					dc.assertOutputContains(consoleOutputCategory, `✓ String .split() splits the string on the delimiter`),
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
					path: dc.isUsingUris ? helloWorldTestMainFile.toString() : fsPath(helloWorldTestMainFile),
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
						path: dc.isUsingUris ? helloWorldTestBrokenFile.toString() : fsPath(helloWorldTestBrokenFile),
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

				const variables = await dc.getTopFrameVariables("Exceptions");
				assert.ok(variables);
				const v = variables.find((v) => v.name === "message");
				assert.ok(v);
				assert.equal(v.evaluateName, "$_threadException.message");
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
				const actualResults = makeTestTextTree(helloWorldTestTreeFile).join("\n");

				assert.ok(expectedResults);
				assert.ok(actualResults);
				checkTreeNodeResults(actualResults, expectedResults);
			});

			it("builds the expected tree if tests are run in multiple overlapping sessions", async () => {
				// https://github.com/Dart-Code/Dart-Code/issues/2934
				await openFile(helloWorldTestShortFile);
				const runTests = async () => {
					// Create separate debug clients for each run, else we'll send multiple
					// launchRequests to the same one.
					const testDc = createDebugClient(DebuggerType.DartTest);
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
				const actualResults = makeTestTextTree(helloWorldTestShortFile).join("\n");

				assert.ok(expectedResults);
				assert.ok(actualResults);
				checkTreeNodeResults(actualResults, expectedResults);
			});

			it("warns if multiple tests run when one was expected", async function () {
				// SDK DAP doesn't warn on this, but will be handled by package:test in future
				// https://github.com/dart-lang/test/issues/1571
				if (dc.isDartDap)
					this.skip();

				await openFile(helloWorldTestDupeNameFile);
				const config = await getResolvedDebugConfiguration(
					testUtils.getLaunchConfig(
						true,
						false,
						false,
						fsPath(helloWorldTestDupeNameFile),
						[{ name: "group test", isGroup: false, position: undefined }],
						runByLine,
						false,
						undefined,
					),
				);
				await dc.start();
				await waitAllThrowIfTerminates(dc,
					dc.configurationSequence(),
					dc.assertOutputContains("console", "You may have multiple tests with the same name"),
					dc.waitForEvent("terminated"),
					dc.launch(config),
				);
			});

			it("runs all tests if given a folder", async () => {
				const config = await startDebugger(dc, "./test/");
				config.noDebug = true;

				const events: vs.DebugSessionCustomEvent[] = [];
				const eventHandler = (e: vs.DebugSessionCustomEvent) => events.push(e);
				dc.on("dart.testNotification", eventHandler);
				await waitAllThrowIfTerminates(dc,
					dc.configurationSequence(),
					dc.waitForEvent("terminated"),
					dc.launch(config),
				);
				dc.removeListener("dart.testNotification", eventHandler);

				const testEvents = events.filter((e) => e.event === "dart.testNotification");
				const suiteEvents = testEvents.filter((e) => e.body.type === "suite");
				const suiteNames = suiteEvents.map((e) => path.basename((e.body as SuiteNotification).suite.path));
				suiteNames.sort();

				assert.deepStrictEqual(
					suiteNames,
					[
						"basic_test.dart",
						"broken_test.dart",
						"discovery_large_test.dart",
						"discovery_test.dart",
						"dupe_name_test.dart",
						"dynamic_test.dart",
						"empty_test.dart",
						"environment_test.dart",
						// These excluded tests show up because we for testing they're
						// directly inside the run folder. For the cases we care about (excluding
						// nexted projects, etc.) this wouldn't happen.
						"excluded_test.dart",
						"excluded_test.dart",
						"folder_test.dart",
						"project_test.dart",
						"rename_test.dart",
						"selective1_test.dart",
						"selective2_test.dart",
						"short_test.dart",
						"skip_test.dart",
						"tree_test.dart",
					],
				);
			});

			it("can run nested projects through Test: Run All Tests", async () => {
				let startedSessions = 0;
				let runningSessions = 0;

				const startSub = vs.debug.onDidStartDebugSession((_s) => {
					startedSessions++;
					runningSessions++;
				});
				const endSub = vs.debug.onDidTerminateDebugSession((_s) => {
					runningSessions--;
				});

				try {
					await captureDebugSessionCustomEvents(async () => vs.commands.executeCommand("testing.runAll"));
					// Allow some time for sessions to start so the startedSessions check doesn't
					// fire immediately after only creating the first session.
					await delay(1000);
					await waitFor(
						() => startedSessions >= 0 && runningSessions === 0,
						300, // check every 300ms
						60000, // wait up to 60 seconds
					);
				} finally {
					startSub.dispose();
					endSub.dispose();
				}
				const testFiles = [
					helloWorldProjectTestFile,
					helloWorldExampleSubFolderProjectTestFile,
				];

				for (const file of testFiles) {
					await openFile(file);
					const expectedResults = getExpectedResults();
					const actualResults = makeTestTextTree(file).join("\n");

					assert.ok(expectedResults);
					assert.ok(actualResults);
					checkTreeNodeResults(actualResults, expectedResults);
				}
			});

			it("can run tests through test controller using default launch template", async () => {
				const suiteID = `SUITE:${fsPath(helloWorldTestEnvironmentFile)}`;
				await privateApi.testDiscoverer?.ensureSuitesDiscovered();

				const controller = privateApi.testController;
				const testNode = controller.controller.items.get(suiteID);
				if (!testNode)
					throw Error(`Unable to find ${suiteID}!`);
				const testRequest = new vs.TestRunRequest([testNode]);
				const customEvents = await captureDebugSessionCustomEvents(async () => controller.runTests(false, false, testRequest, fakeCancellationToken));
				const testEvents = customEvents.filter((e) => e.event === "dart.testNotification");
				const printEvent = testEvents.find((e) => e.body.messageType === "print" && (e.body.message as string).startsWith("LAUNCH_ENV_VAR"));

				assert.equal(printEvent?.body.message, "LAUNCH_ENV_VAR=default");
			});

			it("can run a selection of tests across multiple files", async () => {
				// Discover tests in these files.
				await openFile(helloWorldTestSelective1File);
				await openFile(helloWorldTestSelective2File);
				await waitForResult(() => !!privateApi.fileTracker.getOutlineFor(helloWorldTestSelective1File));
				await waitForResult(() => !!privateApi.fileTracker.getOutlineFor(helloWorldTestSelective2File));
				const controller = privateApi.testController;

				const testItems: vs.TestItem[] = [];

				// Pick multiple tests from multiple files to run.
				const suite1Node = controller.controller.items.get(`SUITE:${fsPath(helloWorldTestSelective1File)}`)!;
				testItems.push(suite1Node.children.get(`TEST:${fsPath(helloWorldTestSelective1File)}:pass one`)!);
				testItems.push(suite1Node.children.get(`TEST:${fsPath(helloWorldTestSelective1File)}:pass two`)!);
				const suite2Node = controller.controller.items.get(`SUITE:${fsPath(helloWorldTestSelective2File)}`)!;
				testItems.push(suite2Node.children.get(`TEST:${fsPath(helloWorldTestSelective2File)}:fail one`)!);
				testItems.push(suite2Node.children.get(`TEST:${fsPath(helloWorldTestSelective2File)}:fail two`)!);
				const testRequest = new vs.TestRunRequest(testItems);

				// Capture all testStart notifications during the debug sessions that are spawned from running these tests.
				const customEvents = await captureDebugSessionCustomEvents(async () => controller.runTests(false, false, testRequest, fakeCancellationToken), true);
				const testEvents = customEvents
					.filter((e) => e.event === "dart.testNotification")
					.filter((e) => e.body.type === "testStart")
					.map((e) => e.body as TestStartNotification)
					.filter((e) => !e.test.name?.startsWith("loading"));
				const testNames = testEvents.map((e) => `${path.basename(fsPath(URI.parse(e.test.url!)))} / ${e.test.name}`);
				testNames.sort(); // The order is not deterministic.

				// Expect exactly the tests we requested.
				assert.deepStrictEqual(testNames, [
					"selective1_test.dart / pass one",
					"selective1_test.dart / pass two",
					"selective2_test.dart / fail one",
					"selective2_test.dart / fail two",
				]);
			});

			it("allows more-specific default launch template using noDebug flag", async () => {
				const suiteID = `SUITE:${fsPath(helloWorldTestEnvironmentFile)}`;
				await privateApi.testDiscoverer?.ensureSuitesDiscovered();

				const controller = privateApi.testController;
				const testNode = controller.controller.items.get(suiteID);
				if (!testNode)
					throw Error(`Unable to find ${suiteID}!`);
				const testRequest = new vs.TestRunRequest([testNode]);
				const customEvents = await captureDebugSessionCustomEvents(async () => controller.runTests(true, false, testRequest, fakeCancellationToken));
				const testEvents = customEvents.filter((e) => e.event === "dart.testNotification");
				const printEvent = testEvents.find((e) => e.body.messageType === "print" && (e.body.message as string).startsWith("LAUNCH_ENV_VAR"));

				assert.equal(printEvent?.body.message, "LAUNCH_ENV_VAR=noDebugExplicitlyFalse");
			});

			it("does not overwrite unrelated test nodes due to overlapping IDs", async () => {
				// When we run an individual test, it will always have an ID of 1. Since the test we ran might
				// not have been ID=1 in the previous run, we need to be sure we update the correct node in the tree.
				// To test it, we'll run the whole suite, ensure the results are as expected, and then re-check it
				// after running each test individually.

				async function checkResults(description: string): Promise<void> {
					logger.info(description);
					const expectedResults = getExpectedResults();
					const actualResults = makeTestTextTree(helloWorldTestTreeFile).join("\n");

					assert.ok(expectedResults);
					assert.ok(actualResults);
					checkTreeNodeResults(actualResults, expectedResults, description);
				}

				await runWithoutDebugging(helloWorldTestTreeFile);
				let numRuns = 1;
				await checkResults(`After initial run`);
				const visitor = new TestOutlineVisitor(logger, fsPath(helloWorldTestTreeFile));
				const outline = privateApi.fileTracker.getOutlineFor(helloWorldTestTreeFile);
				if (!outline)
					throw new Error(`Did not get outline for ${helloWorldTestTreeFile}`);
				visitor.visit(outline);
				for (const test of visitor.tests.filter((t) => !t.isGroup)) {
					// Run the test.
					const execInfo = testUtils.getTestExecutionInfo(fsPath(helloWorldTestTreeFile), [testUtils.getTestSelectionForOutline(test)], runByLine);
					await runWithoutDebugging(
						execInfo.programUri,
						execInfo.args,
						// Ensure the output contained the test name as a sanity check
						// that it ran. Because some tests have variables added to the
						// end, just stop at the $ to avoid failing on them.
						dc.assertOutputContains(consoleOutputCategory, test.fullName.split("$")[0]),
					);
					await checkResults(`After running ${numRuns++} tests (most recently ${test.fullName})`);
				}
			});

			it("merges same name items together", async () => {
				async function checkResults(description: string): Promise<void> {
					logger.info(description);
					const expectedResults = getExpectedResults();
					const actualResults = makeTestTextTree(helloWorldTestDupeNameFile, { sortByLabel: true }).join("\n");

					assert.ok(expectedResults);
					assert.ok(actualResults);
					checkTreeNodeResults(actualResults, expectedResults);
				}

				await runWithoutDebugging(helloWorldTestDupeNameFile);
				await checkResults(`After initial run`);
				const visitor = new TestOutlineVisitor(logger, fsPath(helloWorldTestDupeNameFile));
				const outline = privateApi.fileTracker.getOutlineFor(helloWorldTestDupeNameFile);
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
						const execInfo = testUtils.getTestExecutionInfo(fsPath(helloWorldTestDupeNameFile), [testUtils.getTestSelectionForOutline(test)], runByLine);
						await runWithoutDebugging(execInfo.programUri, execInfo.args);
					}
					await checkResults(`After running tests`);
					// Re-run each group.
					for (const group of visitor.tests.filter((t) => t.isGroup)) {
						const execInfo = testUtils.getTestExecutionInfo(fsPath(helloWorldTestDupeNameFile), [testUtils.getTestSelectionForOutline(group)], runByLine);
						await runWithoutDebugging(execInfo.programUri, execInfo.args);
					}
					await checkResults(`After running groups`);
				}
			}).timeout(160000); // This test runs lots of tests, and they're quite slow to start up currently.

			it("can hide skipped tests and groups from tree", async () => {
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
				let actualResults = makeTestTextTree(helloWorldTestTreeFile).join("\n");
				assert.ok(actualResults);
				checkTreeNodeResults(actualResults, expectedResults);

				// Check toggling the setting results in the skipped nodes being removed.
				await setConfigForTest("dart", "showSkippedTests", false);
				await delay(500); // Allow time for tree to rebuild.
				// Expected results differ from what's in the file not only because skipped tests are hidden, but because
				// the counts on the containing nodes will also be reduced.
				expectedResults = `
test/tree_test.dart [6/8 passed] Failed
    (setUpAll) Passed (utils.dart)
    (tearDownAll) Passed (utils.dart)
    failing group 1 [2/3 passed] Failed
        passing test 1 \${1 + 1} [1/1 passed] Passed
            passing test 1 2 Passed
        failing test 1 $foo [0/1 passed] Failed
            failing test 1 some string Failed
        group 1.1 [1/1 passed] Passed
            passing test 1 with ' some " quotes and newlines in name Passed
    skipped group 2 [1/2 passed] Failed
        passing test 1 Passed
        failing test 1 Failed
    passing group 3 [1/1 passed] Passed
        passing test 1 Passed
		`.trim();
				actualResults = makeTestTextTree(helloWorldTestTreeFile).join("\n");
				assert.ok(actualResults);
				checkTreeNodeResults(actualResults, expectedResults);
			});

			it.skip("removes stale results when running a full suite", () => {
				// Need to rename a test or something to ensure we get a stale result
				// after a full suite run?
			});

			if (runByLine) {
				describe("dynamic tests", () => {
					const issues = [4021, 4150, 4168, 4099, 4250];
					for (const issueNumber of issues) {
						it(`DartCode issue ${issueNumber}`, async () => {
							const issueText = `^https://github.com/Dart-Code/Dart-Code/issues/${issueNumber}`;
							await checkRunSingleTestFromCodeLens(helloWorldTestDynamicFile, issueText, undefined, 1); // delta +1 because comment is on line before the test
						});
					}
				});
			}
		});
	}

	it("keeps test model updated as documents change", async () => {
		await setConfigForTest("dart", "experimentalTestTracking", true);
		writeFileSync(fsPath(helloWorldTestEmptyFile), "");
		await openFile(helloWorldTestEmptyFile);
		await setTestContent(`
import 'package:test/test.dart';
import 'package:test_reflective_loader/test_reflective_loader.dart';

void main() {
  defineReflectiveSuite(() {
    defineReflectiveTests(MyTest);
  });

  group('group1', () {
    test('test1', () {
      expect(1, 1);
    });
  });
}

@reflectiveTest
class MyTest {
  void test_reflected() {
    expect(1, 1);
  }
}
		`.trim());
		await currentEditor().document.save();


		// Initial locations.
		await runWithoutDebugging(helloWorldTestEmptyFile);
		await waitForResult(() => getTestRanges(helloWorldTestEmptyFile).includes("MyTest | test_reflected"));
		assert.equal(
			getTestRanges(helloWorldTestEmptyFile),
			`
test/empty_test.dart
	group1: 8:2-12:4
		test1: 9:4-11:6
	MyTest | test_reflected: 17:2-18:2
			`.trim(),
			"",
		);


		// Insert a line at the start of the doc and ensure everything updates.
		await currentEditor().edit((eb) => eb.insert(new vs.Position(0, 0), "// new first line\n"));
		await delay(50);
		privateApi.testDiscoverer?.forceUpdate(helloWorldTestEmptyFile);
		assert.equal(
			getTestRanges(helloWorldTestEmptyFile),
			`
test/empty_test.dart
	group1: 9:2-13:4
		test1: 10:4-12:6
	MyTest | test_reflected: 18:2-19:2
			`.trim(),
		);
	});

	function getTestRanges(testSuiteUri: vs.Uri) {
		const lines: string[] = [];
		function appendNode(item: vs.TestItem, indent = 0) {
			// Always use forward slashes in the suite paths so the tests work on all platforms.
			const label = item.uri ? item.label.replaceAll("\\", "/") : item.label;
			const rangeInfo = item.range ? `: ${item.range?.start.line}:${item.range?.start.character}-${item.range?.end.line}:${item.range?.end.character}` : "";
			lines.push(`${"\t".repeat(indent)}${label}${rangeInfo}`);
			item.children.forEach((child) => {
				appendNode(child, indent + 1);
			});
		}
		privateApi.testController.controller.items.forEach((item) => {
			if (item.uri && fsPath(item.uri) === fsPath(testSuiteUri))
				appendNode(item);
		});
		return lines.join("\n").trim();
	}

	async function checkRunSingleTestFromCodeLens(fileUri: vs.Uri, search: string, testName: string | undefined, lineDelta = 0) {
		const editor = await openFile(fileUri);
		await waitForResult(() => !!privateApi.fileTracker.getOutlineFor(fileUri));

		const fileCodeLens = await getCodeLens(editor.document);
		const testPos = positionOf(search);

		const codeLensForTest = fileCodeLens.filter((cl) => cl.range.start.line === testPos.line + lineDelta);
		assert.equal(codeLensForTest.length, 2);

		if (!codeLensForTest[0].command) {
			// If there's no command, skip the test. This happens very infrequently and appears to be a VS Code
			// race condition. Rather than failing our test runs, skip.
			// TODO: Remove this if https://github.com/microsoft/vscode/issues/79805 gets a reliable fix.
			return;
		}

		const runAction = codeLensForTest.find((cl) => cl.command!.title === "Run")!;
		assert.equal(runAction.command!.command, "_dart.startWithoutDebuggingTestFromOutline");
		if (testName) {
			assert.equal(runAction.command!.arguments![0].fullName, testName);
			assert.equal(runAction.command!.arguments![0].isGroup, false);
		}

		const customEvents = await captureDebugSessionCustomEvents(async () => {
			const didStart = await vs.commands.executeCommand(runAction.command!.command, ...(runAction.command!.arguments ?? [])); // eslint-disable-line @typescript-eslint/no-unsafe-argument
			assert.ok(didStart);
		});

		// Ensure we got at least a "testDone" notification so we know the test run started correctly.
		const testDoneNotifications = customEvents.filter(isTestDoneSuccessNotification);
		assert.equal(testDoneNotifications.length, 1);
		const testDoneNotification = testDoneNotifications[0];
		assert.ok(testDoneNotification, JSON.stringify(customEvents.map((e: any) => e.body as unknown), undefined, 4));
	}

	async function runWithoutDebugging(file: vs.Uri, args?: string[], ...otherEvents: Array<Promise<any>>): Promise<void> {
		const fileUriWithoutQuery = file.with({ query: "" });
		await openFile(fileUriWithoutQuery);
		const config = await startDebugger(dc, file, { args, noDebug: true });
		await waitAllThrowIfTerminates(dc,
			dc.configurationSequence(),
			dc.waitForEvent("terminated"),
			...otherEvents,
			dc.launch(config),
		);
	}
});

