import { strict as assert } from "assert";
import * as fs from "fs";
import * as path from "path";
import * as vs from "vscode";
import { fsPath } from "../../../shared/utils/fs";
import { waitFor } from "../../../shared/utils/promises";
import { captureTestDebugConfigurations } from "../../debug_helpers";
import { activate, checkTreeNodeResults, clearTestTree, defer, delay, fakeCancellationToken, findProjectNode, findSuiteNode, getExpectedResults, helloWorldExampleSubFolder, helloWorldExampleSubFolderProjectTestFile, helloWorldFolder, helloWorldRenameTestFile, helloWorldTestDiscoveryFile, helloWorldTestDiscoveryLargeFile, helloWorldTestFolder, helloWorldTestMainFile, makeTestTextTree, openFile, privateApi, sb, setTestContent, tryDelete, waitForResult } from "../../helpers";

describe("dart tests", () => {
	beforeEach("activate", () => activate());
	beforeEach("clear test tree", () => clearTestTree());

	it("discovers test when opening a file", async () => {
		// Ensure no results before we start.
		const initialResults = makeTestTextTree({ uriFilter: helloWorldTestDiscoveryFile }).join("\n");
		assert.equal(initialResults, "");

		await openFile(helloWorldTestDiscoveryFile);

		// Try to wait for the tree to update and include the test.
		await waitFor(() => makeTestTextTree({ uriFilter: helloWorldTestDiscoveryFile }).join("\n").includes("test 1"));

		const expectedResults = getExpectedResults();
		const actualResults = makeTestTextTree({ uriFilter: helloWorldTestDiscoveryFile }).join("\n");

		assert.ok(expectedResults);
		assert.ok(actualResults);
		checkTreeNodeResults(actualResults, expectedResults);
	});

	it("handles renaming of discovered tests", async () => {
		await openFile(helloWorldRenameTestFile);
		await setTestContent(`
import "package:test/test.dart";

void main() => test("test 1", () {});
		`);

		// Try to wait for the tree to update and include the test.
		await waitFor(() => makeTestTextTree({ uriFilter: helloWorldRenameTestFile }).join("\n").includes("test 1"));

		let actualResults = makeTestTextTree({ uriFilter: helloWorldRenameTestFile }).join("\n");
		checkTreeNodeResults(actualResults, `
hello_world
    test/rename_test.dart [0/1 passed] Unknown
        test 1 Unknown
		`);

		await setTestContent(`
import "package:test/test.dart";

void main() => test("test 2", () {});
		`);

		// Try to wait for the tree to update and include the new test.
		await waitFor(() => makeTestTextTree({ uriFilter: helloWorldRenameTestFile }).join("\n").includes("test 2"));

		actualResults = makeTestTextTree({ uriFilter: helloWorldRenameTestFile }).join("\n");
		checkTreeNodeResults(actualResults, `
hello_world
    test/rename_test.dart [0/1 passed] Unknown
        test 2 Unknown
		`);
	});

	it("handles renaming of test files discovered from outline before suite discovery", async () => {
		const originalFilename = "disk_rename_before_discovery_original_test.dart";
		const originalFilePath = path.join(fsPath(helloWorldTestFolder), originalFilename);
		defer("Cleanup original", () => tryDelete(originalFilePath));

		const newFilename = "disk_rename_before_discovery_new_test.dart";
		const newFilePath = path.join(fsPath(helloWorldTestFolder), newFilename);
		defer("Cleanup new", () => tryDelete(newFilePath));

		fs.writeFileSync(originalFilePath, `
import "package:test/test.dart";

void main() => test("test 1", () {});
		`);

		// Open the file so it is discovered via the Outline before ensureSuitesDiscovered() has run.
		await openFile(vs.Uri.file(originalFilePath));
		await waitForResult(() => makeTestTextTree().some((s) => s.includes(originalFilename)));

		// Rename the file on disk before full suite discovery has run.
		fs.renameSync(originalFilePath, newFilePath);
		await delay(500);

		// Now trigger full suite discovery (eg. opening the Testing view or running all tests).
		await privateApi.testDiscoverer.ensureSuitesDiscovered();

		await waitForResult(() => makeTestTextTree().some((s) => s.includes(newFilename)));
		assert.equal(makeTestTextTree().some((s) => s.includes(originalFilename)), false);
	});

	it("discovers a large number of tests in a reasonable time", async () => {
		const expectedTestCount = 1250 /* tests */ + 5 /* groups */ + 1 /* file */ + 1 /* project */;
		// Ensure no results before we start.
		const initialResults = makeTestTextTree({ uriFilter: helloWorldTestDiscoveryLargeFile }).join("\n");
		assert.equal(initialResults, "");

		// Open the file and allow time for the outline.
		const startTime = process.hrtime();
		await openFile(helloWorldTestDiscoveryLargeFile);

		// Try to wait for the tree to update and include all of the expected tests.
		await waitFor(() => makeTestTextTree({ uriFilter: helloWorldTestDiscoveryLargeFile }).length, expectedTestCount);

		const testTree = makeTestTextTree({ uriFilter: helloWorldTestDiscoveryLargeFile });
		assert.equal(testTree.length, expectedTestCount);
		const timeTaken = process.hrtime(startTime);
		const timeTakenMs = Math.round(timeTaken[0] * 1000 + timeTaken[1] / 1000000);

		// This outout needs to be high enough to not trigger on slow bots like GH Actions. If
		// this test ends up flaky, we may need tweak it (or use `allowSlowSubscriptionTests`).
		assert.ok(timeTakenMs < 5000, `Took ${timeTakenMs}ms to discover tests`);
	});

	it("does not discover tests in folders excluded by settings", async () => {
		await privateApi.testDiscoverer.ensureSuitesDiscovered();
		const results = makeTestTextTree();
		// Ensure results are valid.
		assert.equal(!!results.find((suite) => suite.includes("basic_test")), true, "basic_test was missing from the test list");
		// Ensure exclusion.
		assert.equal(!!results.find((suite) => suite.includes("excluded_by_setting")), false, "excluded_by_setting was in the test list");
	});

	it("does not discover tests in folders excluded by analysis_options", async () => {
		await privateApi.testDiscoverer.ensureSuitesDiscovered();
		const results = makeTestTextTree();
		// Ensure results are valid.
		assert.equal(!!results.find((suite) => suite.includes("basic_test")), true);
		// Ensure exclusion.
		assert.equal(!!results.find((suite) => suite.includes("excluded_by_analysis_options")), false, "excluded_by_analysis_options was in the test list");
	});

	it("handles create/delete of test files on disk", async () => {
		await privateApi.testDiscoverer.ensureSuitesDiscovered();

		const newFilename = "disk_create_test.dart";
		const newFilePath = path.join(fsPath(helloWorldTestFolder), newFilename);
		defer("Cleanup new", () => tryDelete(newFilePath));

		fs.writeFileSync(newFilePath, `
import "package:test/test.dart";

void main() => test("test inside ${newFilename}", () {});
			`);

		// Ensure the file shows up after it was created.
		await waitForResult(() => makeTestTextTree().some((s) => s.includes(newFilename)));

		// Ensure the test inside it shows up if the file is opened.
		await openFile(vs.Uri.file(newFilePath));
		await waitForResult(() => makeTestTextTree().some((s) => s.includes(`test inside ${newFilename}`)));

		// Ensure both disappear if the file is deleted.
		fs.unlinkSync(newFilePath);
		await waitForResult(() => !makeTestTextTree().some((s) => s.includes(newFilename)));
	});

	it("handles renaming of test files on disk", async () => {
		await privateApi.testDiscoverer.ensureSuitesDiscovered();

		const originalFilename = "disk_rename_original_test.dart";
		const originalFilePath = path.join(fsPath(helloWorldTestFolder), originalFilename);
		defer("Cleanup original", () => tryDelete(originalFilePath));

		const newFilename = "disk_rename_new_test.dart";
		const newFilePath = path.join(fsPath(helloWorldTestFolder), newFilename);
		defer("Cleanup new", () => tryDelete(newFilePath));

		fs.writeFileSync(originalFilePath, "");

		await waitForResult(() => makeTestTextTree().some((s) => s.includes(originalFilename)));

		fs.renameSync(originalFilePath, newFilePath);

		await waitForResult(() => !makeTestTextTree().some((s) => s.includes(originalFilename)));
		await waitForResult(() => makeTestTextTree().some((s) => s.includes(newFilename)));
	});

	it("handles renaming of test folders on disk", async () => {
		await privateApi.testDiscoverer.ensureSuitesDiscovered();

		const originalFoldername = "disk_rename_folder_original";
		const originalFolderPath = path.join(fsPath(helloWorldTestFolder), originalFoldername);
		const originalFilePath = path.join(originalFolderPath, "my_test.dart");
		defer("Cleanup original", () => tryDelete(originalFolderPath));

		const newFoldername = "disk_rename_folder_new";
		const newFolderPath = path.join(fsPath(helloWorldTestFolder), newFoldername);
		defer("Cleanup new", () => tryDelete(newFolderPath));

		fs.mkdirSync(originalFolderPath, { recursive: true });
		fs.writeFileSync(originalFilePath, "");

		await waitForResult(() => makeTestTextTree().some((s) => s.includes(`${originalFoldername}/my_test.dart`)));

		fs.renameSync(originalFolderPath, newFolderPath);

		await waitForResult(() => !makeTestTextTree().some((s) => s.includes(`${originalFoldername}/my_test.dart`)));
		await waitForResult(() => makeTestTextTree().some((s) => s.includes(`${newFoldername}/my_test.dart`)));
	});

	it("discovers tests if runTests is called with undefined include", async () => {
		preventTestSpawning();

		const request = new vs.TestRunRequest();
		const controller = privateApi.testController!;
		await controller.runTests(false, false, request, fakeCancellationToken);
		assert.ok(privateApi.testDiscoverer.testDiscoveryPerformed);
	});

	it("does not discover tests if runTests is called with a test", async () => {
		preventTestSpawning();

		const request = new vs.TestRunRequest([]);
		const controller = privateApi.testController!;
		await controller.runTests(false, false, request, fakeCancellationToken);
		assert.ok(!privateApi.testDiscoverer.testDiscoveryPerformed);
	});

	it("tags project nodes as runnable", async () => {
		await privateApi.testDiscoverer.ensureSuitesDiscovered();

		const projectNode = findProjectNode(fsPath(helloWorldExampleSubFolder));
		assert.ok(projectNode.tags.some((tag) => tag.id === "DartRunnableTest"));
	});

	it("does not launch duplicate test sessions when workspace folders are nested", async () => {
		// https://github.com/Dart-Code/Dart-Code/issues/6215
		await privateApi.testDiscoverer.ensureSuitesDiscovered();
		privateApi.clearCaches();
		defer("Clear project folder cache", () => privateApi.clearCaches());

		// Simulate a multi-root workspace that contains both the parent folder and the nested project folder.
		sb.stub(vs.workspace, "workspaceFolders").value([
			{ index: 0, name: "Hub", uri: helloWorldFolder },
			{ index: 1, name: "App", uri: helloWorldExampleSubFolder },
		]);

		const suiteNode = findSuiteNode(fsPath(helloWorldExampleSubFolderProjectTestFile));
		const configs = await captureTestDebugConfigurations(() => new vs.TestRunRequest([suiteNode]));

		assert.deepStrictEqual(
			configs.map((config) => path.basename(config.program as string)),
			["project_test.dart"],
		);
	});

	it("does not run integration tests across multiple projects concurrently", async () => {
		// https://github.com/Dart-Code/Dart-Code/issues/6243
		const mainIntegrationFolder = path.join(fsPath(helloWorldFolder), "integration_test");
		const mainIntegrationTestFile = path.join(mainIntegrationFolder, "app_test.dart");
		defer("Cleanup main integration_test", () => tryDelete(mainIntegrationFolder));

		// `example` is a nested sub-project with its own pubspec.yaml.
		const exampleIntegrationFolder = path.join(fsPath(helloWorldExampleSubFolder), "integration_test");
		const exampleIntegrationTestFile = path.join(exampleIntegrationFolder, "app_test.dart");
		defer("Cleanup example integration_test", () => tryDelete(exampleIntegrationFolder));

		fs.mkdirSync(mainIntegrationFolder, { recursive: true });
		fs.writeFileSync(mainIntegrationTestFile, "");
		fs.mkdirSync(exampleIntegrationFolder, { recursive: true });
		fs.writeFileSync(exampleIntegrationTestFile, "");

		await privateApi.testDiscoverer.ensureSuitesDiscovered();

		let activeSessions = 0;
		let maxConcurrentSessions = 0;
		const startDebugging = sb.stub(vs.debug, "startDebugging").callsFake(async () => {
			activeSessions++;
			maxConcurrentSessions = Math.max(maxConcurrentSessions, activeSessions);
			// Yield briefly while this session is active so any concurrently-started session overlaps.
			await delay(50);
			activeSessions--;
			// Return false so `runTests` resolves immediately instead of waiting for `onDidTerminateDebugSession`.
			return false;
		});

		const mainSuiteNode = findSuiteNode(mainIntegrationTestFile);
		const exampleSuiteNode = findSuiteNode(exampleIntegrationTestFile);
		const controller = privateApi.testController!;
		await controller.runTests(false, false, new vs.TestRunRequest([mainSuiteNode, exampleSuiteNode]), fakeCancellationToken);

		assert.equal(startDebugging.callCount, 2);
		assert.equal(maxConcurrentSessions, 1);
	});

	it("cancels active session and skips remaining integration test projects when token is cancelled in runAllTestsWithoutDebugging", async () => {
		// https://github.com/Dart-Code/Dart-Code/issues/6247
		const mainIntegrationFolder = path.join(fsPath(helloWorldFolder), "integration_test");
		const mainIntegrationTestFile = path.join(mainIntegrationFolder, "app_test.dart");
		defer("Cleanup main integration_test", () => tryDelete(mainIntegrationFolder));

		const exampleIntegrationFolder = path.join(fsPath(helloWorldExampleSubFolder), "integration_test");
		const exampleIntegrationTestFile = path.join(exampleIntegrationFolder, "app_test.dart");
		defer("Cleanup example integration_test", () => tryDelete(exampleIntegrationFolder));

		fs.mkdirSync(mainIntegrationFolder, { recursive: true });
		fs.writeFileSync(mainIntegrationTestFile, "");
		fs.mkdirSync(exampleIntegrationFolder, { recursive: true });
		fs.writeFileSync(exampleIntegrationTestFile, "");

		await privateApi.testDiscoverer.ensureSuitesDiscovered();

		const { startDebugging, disconnectedSessionIds } = stubDebugSessionsWithCancellation((_session, tokenSource) => {
			tokenSource.cancel();
		});

		const mainSuiteNode = findSuiteNode(mainIntegrationTestFile);
		const exampleSuiteNode = findSuiteNode(exampleIntegrationTestFile);
		const controller = privateApi.testController!;
		await controller.runTests(false, false, new vs.TestRunRequest([mainSuiteNode, exampleSuiteNode]), startDebugging.tokenSource.token);

		assert.equal(startDebugging.stub.callCount, 1);
		assert.equal(disconnectedSessionIds.length, 1);
	});

	it("cancels single-suite test run when TestRunRequest token is cancelled", async () => {
		// https://github.com/Dart-Code/Dart-Code/issues/6247
		await privateApi.testDiscoverer.ensureSuitesDiscovered();

		const { startDebugging, disconnectedSessionIds } = stubDebugSessionsWithCancellation((_session, tokenSource) => {
			tokenSource.cancel();
		});

		const suiteNode = findSuiteNode(fsPath(helloWorldTestMainFile));
		const controller = privateApi.testController!;
		// Use debug=true so we take the single-suite path rather than runAllTestsWithoutDebugging.
		await controller.runTests(true, false, new vs.TestRunRequest([suiteNode]), startDebugging.tokenSource.token);

		assert.equal(startDebugging.stub.callCount, 1);
		assert.equal(disconnectedSessionIds.length, 1);
	});

	it("cancels multi-suite test run and skips remaining suites when TestRunRequest token is cancelled", async () => {
		// https://github.com/Dart-Code/Dart-Code/issues/6247
		await privateApi.testDiscoverer.ensureSuitesDiscovered();

		const { startDebugging, disconnectedSessionIds } = stubDebugSessionsWithCancellation((_session, tokenSource) => {
			tokenSource.cancel();
		});

		const suiteNode1 = findSuiteNode(fsPath(helloWorldTestMainFile));
		const suiteNode2 = findSuiteNode(fsPath(helloWorldExampleSubFolderProjectTestFile));
		const controller = privateApi.testController!;
		// Use debug=true with two suites so we take the multi-suite withProgress path.
		await controller.runTests(true, false, new vs.TestRunRequest([suiteNode1, suiteNode2]), startDebugging.tokenSource.token);

		assert.equal(startDebugging.stub.callCount, 1);
		assert.equal(disconnectedSessionIds.length, 1);
	});

	it("disconnects session if token is cancelled before onDidStartDebugSession fires and does not start if already cancelled", async () => {
		// https://github.com/Dart-Code/Dart-Code/issues/6247
		await privateApi.testDiscoverer.ensureSuitesDiscovered();

		const { startDebugging, disconnectedSessionIds } = stubDebugSessionsWithCancellation((_session, tokenSource) => {
			tokenSource.cancel();
		}, { cancelBeforeSessionStartEvent: true });

		const suiteNode = findSuiteNode(fsPath(helloWorldTestMainFile));
		const controller = privateApi.testController!;
		await controller.runTests(true, false, new vs.TestRunRequest([suiteNode]), startDebugging.tokenSource.token);

		assert.equal(startDebugging.stub.callCount, 1);
		assert.equal(disconnectedSessionIds.length, 1);

		// Calling again with an already-cancelled token should not invoke startDebugging at all.
		await controller.runTests(true, false, new vs.TestRunRequest([suiteNode]), startDebugging.tokenSource.token);
		assert.equal(startDebugging.stub.callCount, 1);
	});

	function stubDebugSessionsWithCancellation(
		onSessionStarted: (session: vs.DebugSession, tokenSource: vs.CancellationTokenSource) => void,
		options?: { cancelBeforeSessionStartEvent?: boolean },
	) {
		const tokenSource = new vs.CancellationTokenSource();
		const didStartEmitter = new vs.EventEmitter<vs.DebugSession>();
		const didTerminateEmitter = new vs.EventEmitter<vs.DebugSession>();
		defer("Dispose cancellation test resources", () => {
			tokenSource.dispose();
			didStartEmitter.dispose();
			didTerminateEmitter.dispose();
		});

		sb.stub(vs.debug, "onDidStartDebugSession").callsFake(didStartEmitter.event);
		sb.stub(vs.debug, "onDidTerminateDebugSession").callsFake(didTerminateEmitter.event);

		const disconnectedSessionIds: string[] = [];
		const stub = sb.stub(vs.debug, "startDebugging").callsFake(async (_folder, launchConfig) => {
			const config = launchConfig as vs.DebugConfiguration;
			const session = {
				configuration: config,
				customRequest: async (command: string) => {
					if (command === "disconnect") {
						disconnectedSessionIds.push(config.dartCodeDebugSessionID as string);
						didTerminateEmitter.fire(session);
					}
				},
			} as unknown as vs.DebugSession;

			if (options?.cancelBeforeSessionStartEvent) {
				onSessionStarted(session, tokenSource);
				didStartEmitter.fire(session);
			} else {
				didStartEmitter.fire(session);
				onSessionStarted(session, tokenSource);
			}

			return true;
		});

		return { startDebugging: { stub, tokenSource }, disconnectedSessionIds };
	}

	function preventTestSpawning() {
		const executeCommand = sb.stub(vs.commands, "executeCommand").callThrough();
		executeCommand.withArgs("_dart.runAllTestsWithoutDebugging").resolves();
		executeCommand.withArgs("_dart.startDebuggingTestsFromVsTestController").resolves();
		executeCommand.withArgs("_dart.startWithoutDebuggingTestsFromVsTestController").resolves();
	}
});
