import { strict as assert } from "assert";
import * as path from "path";
import * as vs from "vscode";
import { DebuggerType, VmServiceExtension } from "../../../shared/enums";
import { TestDoneNotification } from "../../../shared/test_protocol";
import { fsPath } from "../../../shared/utils/fs";
import { waitFor } from "../../../shared/utils/promises";
import { DartDebugClient } from "../../dart_debug_client";
import { createDebugClient, killFlutterTester, startDebugger, waitAllThrowIfTerminates } from "../../debug_helpers";
import { activate, captureDebugSessionCustomEvents, checkTreeNodeResults, customScriptExt, deferUntilLast, delay, ensureArrayContainsArray, ensureHasRunWithArgsStarting, extApi, flutterHelloWorldCounterAppFile, flutterHelloWorldFolder, flutterIntegrationTestFile, flutterTestAnotherFile, flutterTestBrokenFile, flutterTestDriverAppFile, flutterTestDriverTestFile, flutterTestMainFile, flutterTestOtherFile, getCodeLens, getExpectedResults, getResolvedDebugConfiguration, isTestDoneNotification, makeTestTextTree, openFile, positionOf, prepareHasRunFile, setConfigForTest, waitForResult, watchPromise } from "../../helpers";

describe("flutter test debugger", () => {
	beforeEach("activate flutterTestMainFile", () => activate(flutterTestMainFile));

	beforeEach(() => {
		deferUntilLast("Kill flutter_tester", () => watchPromise("Killing flutter_tester processes", killFlutterTester()));
	});

	let dc: DartDebugClient;
	let consoleOutputCategory: string;
	beforeEach("create debug client", function () {
		if (process.env.DART_CODE_FORCE_SDK_DAP === "true" && !extApi.flutterCapabilities.supportsSdkDap)
			this.skip();

		dc = createDebugClient(DebuggerType.FlutterTest);
		consoleOutputCategory = dc.isDartDap ? "console" : "stdout";
	});

	describe("resolves the correct debug config", () => {
		it("for a simple script", async () => {
			const resolvedConfig = await getResolvedDebugConfiguration({
				args: ["--foo"],
				program: fsPath(flutterTestMainFile),
			})!;

			assert.ok(resolvedConfig);
			assert.equal(resolvedConfig.program, fsPath(flutterTestMainFile));
			assert.equal(resolvedConfig.cwd, fsPath(flutterHelloWorldFolder));
			assert.deepStrictEqual(resolvedConfig.args, ["--foo"]);
		});

		it("when flutterTestAdditionalArgs is set", async () => {
			await setConfigForTest("dart", "flutterTestAdditionalArgs", ["--no-sound-null-safety"]);
			const resolvedConfig = await getResolvedDebugConfiguration({
				program: fsPath(flutterTestMainFile),
			})!;

			ensureArrayContainsArray(resolvedConfig.toolArgs!, ["--no-sound-null-safety"]);
		});

		it("when suppressTestTimeouts is set", async () => {
			await setConfigForTest("dart", "suppressTestTimeouts", "always");
			const resolvedConfig = await getResolvedDebugConfiguration({
				program: fsPath(flutterTestMainFile),
			})!;

			ensureArrayContainsArray(resolvedConfig.toolArgs!, ["--timeout"]);
		});
	});

	for (const runByLine of [false, true]) {
		describe(`when running tests by ${runByLine ? "line" : "name"}`, () => {
			beforeEach("set config.testInvocationMode", async () => {
				await setConfigForTest("dart", "testInvocationMode", runByLine ? "line" : "name");
			});

			it("runs a Flutter test script to completion", async () => {
				const config = await startDebugger(dc, flutterTestMainFile);
				await waitAllThrowIfTerminates(dc,
					dc.configurationSequence(),
					dc.waitForEvent("terminated"),
					dc.launch(config),
				);
			});

			it("can run tests from codelens", async function () {
				const editor = await openFile(flutterTestMainFile);
				await waitForResult(() => !!extApi.fileTracker.getOutlineFor(flutterTestMainFile), "Outline for main file");

				const fileCodeLens = await getCodeLens(editor.document);
				const testPos = positionOf(`test^Widgets('Hello world test`);

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
				assert.equal(runAction.command!.arguments![0].fullName, "Hello world test");
				assert.equal(runAction.command!.arguments![0].isGroup, false);

				const customEvents = await captureDebugSessionCustomEvents(async () => {
					const didStart = await vs.commands.executeCommand(runAction.command!.command, ...(runAction.command!.arguments ?? [])); // eslint-disable-line @typescript-eslint/no-unsafe-argument
					assert.ok(didStart);
				});

				// Ensure we got at least a "testDone" notification so we know the test run started correctly.
				const testDoneNotification = customEvents.find(isTestDoneNotification);
				assert.ok(testDoneNotification, JSON.stringify(customEvents.map((e) => e.body), undefined, 4));
			});

			it("can run test with multiline name from codelens", async function () {
				const editor = await openFile(flutterTestMainFile);
				await waitForResult(() => !!extApi.fileTracker.getOutlineFor(flutterTestMainFile), "Outline for main file");

				const fileCodeLens = await getCodeLens(editor.document);
				const testPos = positionOf(`test^Widgets('''multi`);

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
				assert.equal(runAction.command!.arguments![0].fullName, "multi\nline\ntest");
				assert.equal(runAction.command!.arguments![0].isGroup, false);

				const customEvents = await captureDebugSessionCustomEvents(async () => {
					const didStart = await vs.commands.executeCommand(runAction.command!.command, ...(runAction.command!.arguments ?? [])); // eslint-disable-line @typescript-eslint/no-unsafe-argument
					assert.ok(didStart);
				});

				// Ensure we got at least a "testDone" notification so we know the test run started correctly.
				const testDoneNotification = customEvents.find(isTestDoneNotification);
				assert.ok(testDoneNotification, JSON.stringify(customEvents.map((e) => e.body), undefined, 4));
			});

			it("does not attempt to run skipped tests from codelens if not supported", async function () {
				if (extApi.flutterCapabilities.supportsRunSkippedTests)
					this.skip();

				const editor = await openFile(flutterTestMainFile);
				await waitForResult(() => !!extApi.fileTracker.getOutlineFor(flutterTestMainFile), "Outline for main file");

				const fileCodeLens = await getCodeLens(editor.document);
				const testPos = positionOf(`test^Widgets('Skipped test`);

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
				assert.equal(runAction.command!.arguments![0].fullName, "Skipped test");
				assert.equal(runAction.command!.arguments![0].isGroup, false);

				const customEvents = await captureDebugSessionCustomEvents(async () => {
					const didStart = await vs.commands.executeCommand(runAction.command!.command, ...(runAction.command!.arguments ?? [])); // eslint-disable-line @typescript-eslint/no-unsafe-argument
					assert.ok(didStart);
				});

				const testDoneNotification = customEvents.find(isTestDoneNotification);
				assert.ok(testDoneNotification, JSON.stringify(customEvents.map((e) => e.body), undefined, 4));

				const testDone = testDoneNotification.body as TestDoneNotification;
				assert.equal(testDone.skipped, true);
			});

			it("can run skipped tests from codelens if supported", async function () {
				if (!extApi.flutterCapabilities.supportsRunSkippedTests)
					this.skip();

				const editor = await openFile(flutterTestMainFile);
				await waitForResult(() => !!extApi.fileTracker.getOutlineFor(flutterTestMainFile), "Outline for main file");

				const fileCodeLens = await getCodeLens(editor.document);
				const testPos = positionOf(`test^Widgets('Skipped test`);

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
				assert.equal(runAction.command!.arguments![0].fullName, "Skipped test");
				assert.equal(runAction.command!.arguments![0].isGroup, false);

				const customEvents = await captureDebugSessionCustomEvents(async () => {
					const didStart = await vs.commands.executeCommand(runAction.command!.command, ...(runAction.command!.arguments ?? [])); // eslint-disable-line @typescript-eslint/no-unsafe-argument
					assert.ok(didStart);
				});

				const testDoneNotification = customEvents.find(isTestDoneNotification);
				assert.ok(testDoneNotification, JSON.stringify(customEvents.map((e) => e.body), undefined, 4));

				const testDone = testDoneNotification.body as TestDoneNotification;
				assert.equal(testDone.skipped, false); // Test should have run.
			});

			it("receives the expected events from a Flutter test script", async () => {
				const config = await startDebugger(dc, flutterTestMainFile);
				await waitAllThrowIfTerminates(dc,
					dc.configurationSequence(),
					dc.assertOutputContains(consoleOutputCategory, `✓ Hello world test`),
					dc.waitForEvent("terminated"),
					dc.assertPassingTest(`Hello world test`),
					dc.launch(config),
				);
			});

			it("successfully runs a Flutter test script with a relative path", async () => {
				const config = await startDebugger(dc, flutterTestMainFile);
				config.program = path.relative(fsPath(flutterHelloWorldFolder), fsPath(flutterTestMainFile));
				await waitAllThrowIfTerminates(dc,
					dc.configurationSequence(),
					dc.assertOutputContains(consoleOutputCategory, `✓ Hello world test`),
					dc.assertPassingTest(`Hello world test`),
					dc.waitForEvent("terminated"),
					dc.launch(config),
				);
			});

			it("runs the provided script regardless of what's open", async () => {
				await openFile(flutterTestMainFile);
				const config = await startDebugger(dc, flutterTestOtherFile);
				await waitAllThrowIfTerminates(dc,
					dc.configurationSequence(),
					dc.assertOutputContains(consoleOutputCategory, `✓ Other tests group Other test\n`),
					dc.assertPassingTest(`Other tests group Other test`),
					dc.waitForEvent("terminated"),
					dc.launch(config),
				);
			});

			it("runs the open script if no file is provided", async () => {
				await openFile(flutterTestOtherFile);
				const config = await startDebugger(dc, undefined);
				await waitAllThrowIfTerminates(dc,
					dc.configurationSequence(),
					dc.assertOutputContains(consoleOutputCategory, `✓ Other tests group Other test\n`),
					dc.assertPassingTest(`Other tests group Other test`),
					dc.waitForEvent("terminated"),
					dc.launch(config),
				);
			});

			it("runs all tests if given a folder", async () => {
				const config = await startDebugger(dc, "./test/");
				config.noDebug = true;
				await waitAllThrowIfTerminates(dc,
					dc.configurationSequence(),
					dc.waitForEvent("terminated"),
					dc.launch(config),
				);

				const testFiles = [
					flutterTestMainFile,
					flutterTestOtherFile,
					flutterTestAnotherFile,
					flutterTestBrokenFile,
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

			it("runs all tests through Test: Run All Tests", async () => {
				let startedSessions = 0;
				let runningSessions = 0;

				const startSub = vs.debug.onDidStartDebugSession((s) => {
					startedSessions++;
					runningSessions++;
				});
				const endSub = vs.debug.onDidTerminateDebugSession((s) => {
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
					flutterTestMainFile,
					flutterTestOtherFile,
					flutterTestAnotherFile,
					flutterTestBrokenFile,
					flutterIntegrationTestFile,
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

			it("can run using a custom tool", async () => {
				const root = fsPath(flutterHelloWorldFolder);
				const hasRunFile = prepareHasRunFile(root, "flutter_test");

				const config = await startDebugger(dc, flutterTestMainFile, {
					customTool: path.join(root, `scripts/custom_flutter_test.${customScriptExt}`),
					customToolReplacesArgs: 0,
				});
				await waitAllThrowIfTerminates(dc,
					dc.configurationSequence(),
					dc.waitForEvent("terminated"),
					dc.launch(config),
				);

				const expected = dc.isDartDap && extApi.flutterCapabilities.requiresDdsDisabledForSdkDapTestRuns
					// Allow --no-dds temporarily while we're passing it due to requiresDdsDisabledForSdkDapTestRuns.
					? ["test --machine --no-dds --start-paused", "test --machine --start-paused"]
					: ["test --machine --start-paused"];
				ensureHasRunWithArgsStarting(root, hasRunFile, ...expected);
			});

			it("can replace all args using custom tool", async () => {
				const root = fsPath(flutterHelloWorldFolder);
				const hasRunFile = prepareHasRunFile(root, "flutter_test");

				const config = await startDebugger(dc, flutterTestMainFile, {
					customTool: path.join(root, `scripts/custom_flutter_test.${customScriptExt}`),
					customToolReplacesArgs: 999999,
					// These differ to the usual ones so we can detect they replaced them.
					toolArgs: ["test", "--total-shards", "1", "--shard-index", "0", "--start-paused", "--machine", "-d", "flutter-tester"],
				});
				await waitAllThrowIfTerminates(dc,
					dc.configurationSequence(),
					dc.waitForEvent("terminated"),
					dc.launch(config),
				);

				ensureHasRunWithArgsStarting(root, hasRunFile, "test --total-shards 1 --shard-index 0 --start-paused --machine -d flutter-tester");
			});

			it("stops at a breakpoint", async () => {
				await openFile(flutterTestMainFile);
				const config = await startDebugger(dc, flutterTestMainFile);
				await dc.hitBreakpoint(config, {
					line: positionOf("^// BREAKPOINT1").line + 1, // positionOf is 0-based, but seems to want 1-based
					path: fsPath(flutterTestMainFile),
				});
			});

			it("stops on exception", async () => {
				await openFile(flutterTestBrokenFile);
				const config = await startDebugger(dc, flutterTestBrokenFile);
				await waitAllThrowIfTerminates(dc,
					dc.configurationSequence(),
					dc.assertStoppedLocation("exception", {}),
					dc.launch(config),
				);
			});

			it.skip("stops at the correct location on exception", async () => {
				// TODO: Check the expected location is in the call stack, and that the frames above it are all marked
				// as deemphasized.
				await openFile(flutterTestBrokenFile);
				const config = await startDebugger(dc, flutterTestBrokenFile);
				await waitAllThrowIfTerminates(dc,
					dc.configurationSequence(),
					dc.assertStoppedLocation("exception", {
						line: positionOf("^won't find this").line + 1, // positionOf is 0-based, but seems to want 1-based
						path: fsPath(flutterTestBrokenFile),
					}),
					dc.launch(config),
				);
			});

			it("provides exception details when stopped on exception", async () => {
				await openFile(flutterTestBrokenFile);
				const config = await startDebugger(dc, flutterTestBrokenFile);
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
				assert.ok(v.value.startsWith(`"Expected: exactly one matching node in the widget tree`));
			});

			it("send failure results for failing tests", async () => {
				await openFile(flutterTestBrokenFile);
				const config = await startDebugger(dc, flutterTestBrokenFile);
				config.noDebug = true;
				await waitAllThrowIfTerminates(dc,
					dc.configurationSequence(),
					dc.assertErroringTest(`Hello world test`),
					dc.assertOutput("stderr", "Test failed. See exception logs above.\n"),
					dc.assertOutputContains("stdout", "EXCEPTION CAUGHT BY FLUTTER TEST FRAMEWORK"),
					dc.launch(config),
				);
			});

			it("can run test_driver tests", async function () {
				if (dc.isDartDap && !extApi.flutterCapabilities.supportsEnvInSdkDAP)
					this.skip();

				// Start the instrumented app.
				const appDc = createDebugClient(DebuggerType.Flutter);
				const appConfig = await startDebugger(appDc, flutterTestDriverAppFile);
				await waitAllThrowIfTerminates(appDc,
					appDc.configurationSequence(),
					appDc.launch(appConfig),
				);

				// Allow some time for the debug service to register its Driver extension so we can find it when
				// looking for the app debug session later.
				await waitFor(
					() => extApi.debugSessions.find((s) => s.loadedServiceExtensions.indexOf(VmServiceExtension.Driver) !== -1),
					100, // checkEveryMilliseconds
					30000, // tryForMilliseconds
				);

				// Run the integration tests
				const config = await startDebugger(dc, flutterTestDriverTestFile);
				config.noDebug = true;
				await waitAllThrowIfTerminates(dc,
					dc.configurationSequence(),
					dc.assertPassingTest(`Counter App increments the counter`),
					dc.launch(config),
				);
			});

			it("can run integration_test tests", async function () {
				if (!extApi.flutterCapabilities.supportsRunningIntegrationTests)
					this.skip();

				const config = await startDebugger(dc, flutterIntegrationTestFile);
				config.noDebug = true;

				await waitAllThrowIfTerminates(dc,
					dc.configurationSequence(),
					dc.assertPassingTest(`Counter App increments the counter`),
					dc.launch(config),
				);
			});

			it("stops at a breakpoint in test code in integration_test tests", async function () {
				if (!extApi.flutterCapabilities.supportsRunningIntegrationTests)
					this.skip();

				await openFile(flutterIntegrationTestFile);
				const config = await startDebugger(dc, flutterIntegrationTestFile);

				await waitAllThrowIfTerminates(dc,
					dc.hitBreakpoint(config, {
						line: positionOf("^// BREAKPOINT1").line,
						path: fsPath(flutterIntegrationTestFile),
					}),
				);
			});

			it("stops at a breakpoint in app code in integration_test tests", async function () {
				if (!extApi.flutterCapabilities.supportsRunningIntegrationTests)
					this.skip();

				await openFile(flutterHelloWorldCounterAppFile);
				const config = await startDebugger(dc, flutterIntegrationTestFile);

				await waitAllThrowIfTerminates(dc,
					dc.hitBreakpoint(config, {
						line: positionOf("^// BREAKPOINT1").line,
						path: fsPath(flutterHelloWorldCounterAppFile),
					}),
				);
			});
		});
	}
});

