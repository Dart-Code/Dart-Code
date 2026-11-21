import { strict as assert } from "assert";
import * as path from "path";
import * as vs from "vscode";
import * as constants from "../../../shared/constants";
import { Logger } from "../../../shared/interfaces";
import { nullLogger } from "../../../shared/logging";
import { TestSessionCoordinator } from "../../../shared/test/coordinator";
import { TestModel, TestSource } from "../../../shared/test/test_model";
import { GroupNotification, SuiteNotification, TestStartNotification } from "../../../shared/test_protocol";
import { fsPath } from "../../../shared/utils/fs";
import { waitFor } from "../../../shared/utils/promises";
import { activate, checkTreeNodeResults, clearTestTree, closeAllOpenFiles, defer, delay, findSuiteNode, getPackages, helloWorldFolder, helloWorldRenameTestFile, helloWorldTestFolder, makeTestTextTree, openFile, privateApi, sb, setTestContent } from "../../helpers";

describe("test coordinator", () => {
	before("get packages", () => getPackages());
	beforeEach("activate", () => activate());
	beforeEach("clear test tree", () => clearTestTree());

	it("hides an in-progress suite load node if the session ends before testDone", async () => {
		await openFile(helloWorldRenameTestFile);
		await setTestContent(`
import "package:test/test.dart";

void main() => test("test 1", () {});
		`);

		await waitFor(() => makeTestTextTree({ uriFilter: helloWorldRenameTestFile }).join("\n").includes("test 1"));

		const suitePath = fsPath(helloWorldRenameTestFile);
		const coordinator = privateApi.testCoordinator;
		const sessionID = "session-interrupted-load";
		const debugSessionID = "dbg-interrupted-load";
		defer("End test coordinator session", () => {
			coordinator.handleDebugSessionEnd(debugSessionID, sessionID);
			privateApi.testController?.handleDebugSessionEnd({ configuration: { dartCodeDebugSessionID: sessionID } } as unknown as vs.DebugSession);
		});

		coordinator.handleDebugSessionStart(debugSessionID, sessionID, fsPath(helloWorldFolder));
		coordinator.handleDebugSessionCustomEvent(debugSessionID, sessionID, "dart.testNotification", {
			suite: { id: 0, path: suitePath, platform: "vm" },
			time: 0,
			type: "suite",
		});
		coordinator.handleDebugSessionCustomEvent(debugSessionID, sessionID, "dart.testNotification", {
			test: { groupIDs: [], id: 1, name: `loading ${suitePath}`, suiteID: 0 },
			time: 1,
			type: "testStart",
		});
		assert.ok(makeTestTextTree({ uriFilter: helloWorldRenameTestFile }).join("\n").includes("Loading..."));

		coordinator.handleDebugSessionEnd(debugSessionID, sessionID);
		privateApi.testController?.handleDebugSessionEnd({ configuration: { dartCodeDebugSessionID: sessionID } } as unknown as vs.DebugSession);
		checkTreeNodeResults(makeTestTextTree({ uriFilter: helloWorldRenameTestFile }).join("\n"), `
hello_world
    test/rename_test.dart [0/1 passed] Unknown
        test 1 Unknown
		`);
	});

	it("surfaces out-of-band suite load errors emitted after initial hidden testDone", async () => {
		await openFile(helloWorldRenameTestFile);
		await setTestContent(`
import "package:test/test.dart";

void main() => test("test 1", () {});
		`);

		await waitFor(() => makeTestTextTree({ uriFilter: helloWorldRenameTestFile }).join("\n").includes("test 1"));

		const suitePath = fsPath(helloWorldRenameTestFile);
		const coordinator = privateApi.testCoordinator;
		const controller = privateApi.testController!;
		const createTestRunOriginal = controller.controller.createTestRun.bind(controller.controller);
		let erroredSpy: ReturnType<typeof sb.spy> | undefined;
		let appendOutputSpy: ReturnType<typeof sb.spy> | undefined;
		sb.stub(controller.controller, "createTestRun").callsFake((...args: Parameters<typeof controller.controller.createTestRun>) => {
			const run = createTestRunOriginal(...args);
			erroredSpy = sb.spy(run, "errored");
			appendOutputSpy = sb.spy(run, "appendOutput");
			return run;
		});

		const sessionID = "session-oob";
		const debugSessionID = "dbg-1";
		defer("End test coordinator session", () => {
			coordinator.handleDebugSessionEnd(debugSessionID, sessionID);
			privateApi.testController?.handleDebugSessionEnd({ configuration: { dartCodeDebugSessionID: sessionID } } as unknown as vs.DebugSession);
		});

		coordinator.handleDebugSessionStart(debugSessionID, sessionID, fsPath(helloWorldFolder));
		coordinator.handleDebugSessionCustomEvent(debugSessionID, sessionID, "dart.testNotification", {
			suite: { id: 0, path: suitePath, platform: "vm" },
			time: 0,
			type: "suite",
		});
		const rawStartName = `loading ${suitePath}`;
		const startEvt = {
			test: { groupIDs: [], id: 1, name: rawStartName, suiteID: 0 },
			time: 1,
			type: "testStart",
		};
		coordinator.handleDebugSessionCustomEvent(debugSessionID, sessionID, "dart.testNotification", startEvt);
		assert.equal(startEvt.test.name, rawStartName, "shared notification payload should not be mutated");

		coordinator.handleDebugSessionCustomEvent(debugSessionID, sessionID, "dart.testNotification", {
			hidden: true,
			result: "success",
			skipped: false,
			testID: 1,
			time: 2,
			type: "testDone",
		});
		// Output emitted for a loading test goes to TestRun without a TestItem so the hidden node is not added to Test Results.
		coordinator.handleDebugSessionCustomEvent(debugSessionID, sessionID, "dart.testNotification", {
			message: "late print message",
			messageType: "print",
			testID: 1,
			time: 3,
			type: "print",
		});
		assert.equal(appendOutputSpy?.callCount, 1);
		assert.equal(appendOutputSpy?.firstCall.args[2], undefined);

		coordinator.handleDebugSessionCustomEvent(debugSessionID, sessionID, "dart.testNotification", {
			error: "Exception: async main error",
			isFailure: false,
			stackTrace: "stack",
			testID: 1,
			time: 4,
			type: "error",
		});
		// Follow-up errors after the node is already unhidden should also stream to TestRun.
		coordinator.handleDebugSessionCustomEvent(debugSessionID, sessionID, "dart.testNotification", {
			error: "Exception: second async error",
			isFailure: false,
			stackTrace: "stack2",
			testID: 1,
			time: 5,
			type: "error",
		});
		coordinator.handleDebugSessionEnd(debugSessionID, sessionID);
		privateApi.testController?.handleDebugSessionEnd({ configuration: { dartCodeDebugSessionID: sessionID } } as unknown as vs.DebugSession);

		assert.equal(erroredSpy?.callCount, 1);
		assert.equal((erroredSpy?.firstCall.args[0] as vs.TestItem).label, "Failed to load");
		const message = erroredSpy?.firstCall.args[1] as vs.TestMessage;
		const messageText = typeof message.message === "string" ? message.message : message.message.value;
		assert.ok(messageText.includes("late print message"));
		assert.ok(messageText.includes("async main error"));
		assert.equal(appendOutputSpy?.getCalls().every((c) => c.args[2] === undefined), true);
		const runOutput = appendOutputSpy?.getCalls().map((c) => String(c.args[0])).join("") ?? "";
		assert.equal(runOutput.split("late print message").length - 1, 1, runOutput);
		assert.ok(runOutput.includes("async main error"), runOutput);
		assert.ok(runOutput.includes("second async error"), runOutput);
		checkTreeNodeResults(makeTestTextTree({ uriFilter: helloWorldRenameTestFile }).join("\n"), `
hello_world
    test/rename_test.dart [0/1 passed] Failed
        test 1 Unknown
        Failed to load Failed
		`);
	});

	it("surfaces out-of-band (setUpAll) errors emitted after initial passing testDone", async () => {
		await openFile(helloWorldRenameTestFile);
		await setTestContent(`
import "package:test/test.dart";

void main() => test("test 1", () {});
		`.trim());

		await waitFor(() => makeTestTextTree({ uriFilter: helloWorldRenameTestFile }).join("\n").includes("test 1"));

		const suitePath = fsPath(helloWorldRenameTestFile);
		const utilsPath = path.join(fsPath(helloWorldTestFolder), "utils.dart");
		const suiteUri = vs.Uri.file(suitePath).toString();
		const utilsUri = vs.Uri.file(utilsPath).toString();
		const coordinator = privateApi.testCoordinator;
		const controller = privateApi.testController!;
		const createTestRunOriginal = controller.controller.createTestRun.bind(controller.controller);
		let erroredSpy: ReturnType<typeof sb.spy> | undefined;
		let failedSpy: ReturnType<typeof sb.spy> | undefined;
		let appendOutputSpy: ReturnType<typeof sb.spy> | undefined;
		sb.stub(controller.controller, "createTestRun").callsFake((...args: Parameters<typeof controller.controller.createTestRun>) => {
			const run = createTestRunOriginal(...args);
			erroredSpy = sb.spy(run, "errored");
			failedSpy = sb.spy(run, "failed");
			appendOutputSpy = sb.spy(run, "appendOutput");
			return run;
		});

		const sessionID = "session-oob-setupall";
		const debugSessionID = "dbg-oob-setupall";
		defer("End test coordinator session", () => {
			coordinator.handleDebugSessionEnd(debugSessionID, sessionID);
			privateApi.testController?.handleDebugSessionEnd({ configuration: { dartCodeDebugSessionID: sessionID } } as unknown as vs.DebugSession);
		});

		coordinator.handleDebugSessionStart(debugSessionID, sessionID, fsPath(helloWorldFolder));
		coordinator.handleDebugSessionCustomEvent(debugSessionID, sessionID, "dart.testNotification", {
			suite: { id: 0, path: suitePath, platform: "vm" },
			time: 0,
			type: "suite",
		});
		coordinator.handleDebugSessionCustomEvent(debugSessionID, sessionID, "dart.testNotification", {
			test: {
				column: 3,
				groupIDs: [],
				id: 1,
				line: 4,
				name: "(setUpAll)",
				root_column: 3, // eslint-disable-line camelcase
				root_line: 3, // eslint-disable-line camelcase
				root_url: suiteUri, // eslint-disable-line camelcase
				suiteID: 0,
				url: utilsUri,
			},
			time: 1,
			type: "testStart",
		});

		coordinator.handleDebugSessionCustomEvent(debugSessionID, sessionID, "dart.testNotification", {
			hidden: true,
			result: "success",
			skipped: false,
			testID: 1,
			time: 2,
			type: "testDone",
		});
		checkTreeNodeResults(makeTestTextTree({ uriFilter: helloWorldRenameTestFile }).join("\n"), `
hello_world
    test/rename_test.dart [0/1 passed] Unknown
        test 1 Unknown
        (setUpAll) Passed (utils.dart)
		`);

		coordinator.handleDebugSessionCustomEvent(debugSessionID, sessionID, "dart.testNotification", {
			message: "late setUpAll print",
			messageType: "print",
			testID: 1,
			time: 3,
			type: "print",
		});
		assert.equal(appendOutputSpy?.callCount, 1);

		coordinator.handleDebugSessionCustomEvent(debugSessionID, sessionID, "dart.testNotification", {
			error: "Exception: async setUpAll error",
			isFailure: true,
			stackTrace: "stack",
			testID: 1,
			time: 4,
			type: "error",
		});
		coordinator.handleDebugSessionCustomEvent(debugSessionID, sessionID, "dart.testNotification", {
			error: "Exception: second setUpAll error",
			isFailure: false,
			stackTrace: "stack2",
			testID: 1,
			time: 5,
			type: "error",
		});
		coordinator.handleDebugSessionEnd(debugSessionID, sessionID);
		privateApi.testController?.handleDebugSessionEnd({ configuration: { dartCodeDebugSessionID: sessionID } } as unknown as vs.DebugSession);

		assert.equal(erroredSpy?.callCount, 0);
		assert.equal(failedSpy?.callCount, 1);
		assert.equal((failedSpy?.firstCall.args[0] as vs.TestItem).label, "(setUpAll)");
		const message = failedSpy?.firstCall.args[1] as vs.TestMessage;
		const messageText = typeof message.message === "string" ? message.message : message.message.value;
		assert.ok(messageText.includes("late setUpAll print"));
		assert.ok(messageText.includes("async setUpAll error"));
		const runOutput = appendOutputSpy?.getCalls().map((c) => String(c.args[0])).join("") ?? "";
		assert.equal(runOutput.split("late setUpAll print").length - 1, 1, runOutput);
		assert.ok(runOutput.includes("async setUpAll error"), runOutput);
		assert.ok(runOutput.includes("second setUpAll error"), runOutput);
		checkTreeNodeResults(makeTestTextTree({ uriFilter: helloWorldRenameTestFile }).join("\n"), `
hello_world
    test/rename_test.dart [0/1 passed] Failed
        test 1 Unknown
        (setUpAll) Failed (utils.dart)
		`);
	});

	it("resolves group-scoped (setUpAll) to its declaration file while keeping user tests at root_url", async () => {
		await openFile(helloWorldRenameTestFile);
		await setTestContent(`
import "package:test/test.dart";

void main() {
  group("my group", () {
    test("calls (setUpAll)", () {});
  });
}
		`.trim());

		await waitFor(() => makeTestTextTree({ uriFilter: helloWorldRenameTestFile }).join("\n").includes("calls (setUpAll)"));

		const suitePath = fsPath(helloWorldRenameTestFile);
		const utilsPath = path.join(fsPath(helloWorldTestFolder), "utils.dart");
		const suiteUri = vs.Uri.file(suitePath).toString();
		const utilsUri = vs.Uri.file(utilsPath).toString();
		const coordinator = privateApi.testCoordinator;
		const sessionID = "session-group-setupall-location";
		const debugSessionID = "dbg-group-setupall-location";
		defer("End test coordinator session", () => {
			coordinator.handleDebugSessionEnd(debugSessionID, sessionID);
			privateApi.testController?.handleDebugSessionEnd({ configuration: { dartCodeDebugSessionID: sessionID } } as unknown as vs.DebugSession);
		});

		coordinator.handleDebugSessionStart(debugSessionID, sessionID, fsPath(helloWorldFolder));
		coordinator.handleDebugSessionCustomEvent(debugSessionID, sessionID, "dart.testNotification", {
			suite: { id: 0, path: path.relative(fsPath(helloWorldFolder), suitePath), platform: "vm" },
			time: 0,
			type: "suite",
		});
		coordinator.handleDebugSessionCustomEvent(debugSessionID, sessionID, "dart.testNotification", {
			group: { id: 2, name: "", parentID: undefined, suiteID: 0, testCount: 2 },
			time: 1,
			type: "group",
		});
		coordinator.handleDebugSessionCustomEvent(debugSessionID, sessionID, "dart.testNotification", {
			group: { column: 3, id: 4, line: 4, name: "my group", parentID: 2, suiteID: 0, testCount: 2, url: suiteUri },
			time: 2,
			type: "group",
		});
		coordinator.handleDebugSessionCustomEvent(debugSessionID, sessionID, "dart.testNotification", {
			test: {
				column: 3,
				groupIDs: [2, 4],
				id: 5,
				line: 4,
				name: "my group (setUpAll)",
				root_column: 3, // eslint-disable-line camelcase
				root_line: 4, // eslint-disable-line camelcase
				root_url: suiteUri, // eslint-disable-line camelcase
				suiteID: 0,
				url: utilsUri,
			},
			time: 3,
			type: "testStart",
		});
		coordinator.handleDebugSessionCustomEvent(debugSessionID, sessionID, "dart.testNotification", {
			error: "Exception: group setUpAll error",
			isFailure: false,
			stackTrace: "stack",
			testID: 5,
			time: 4,
			type: "error",
		});
		coordinator.handleDebugSessionCustomEvent(debugSessionID, sessionID, "dart.testNotification", {
			hidden: false,
			result: "error",
			skipped: false,
			testID: 5,
			time: 5,
			type: "testDone",
		});
		coordinator.handleDebugSessionCustomEvent(debugSessionID, sessionID, "dart.testNotification", {
			test: {
				column: 3,
				groupIDs: [2, 4],
				id: 6,
				line: 10,
				name: "my group calls (setUpAll)",
				root_column: 5, // eslint-disable-line camelcase
				root_line: 5, // eslint-disable-line camelcase
				root_url: suiteUri, // eslint-disable-line camelcase
				suiteID: 0,
				url: utilsUri,
			},
			time: 6,
			type: "testStart",
		});
		coordinator.handleDebugSessionCustomEvent(debugSessionID, sessionID, "dart.testNotification", {
			hidden: false,
			result: "success",
			skipped: false,
			testID: 6,
			time: 7,
			type: "testDone",
		});
		coordinator.handleDebugSessionEnd(debugSessionID, sessionID);
		privateApi.testController?.handleDebugSessionEnd({ configuration: { dartCodeDebugSessionID: sessionID } } as unknown as vs.DebugSession);

		const suiteItem = findSuiteNode(suitePath);
		const groupItem = suiteItem.children.get(`GROUP:${suitePath}:my group`)!;
		const setUpAllItem = groupItem.children.get(`TEST:${suitePath}:my group (setUpAll)`)!;
		const userTestItem = groupItem.children.get(`TEST:${suitePath}:my group calls (setUpAll)`)!;

		assert.ok(setUpAllItem, "Expected failed group (setUpAll) item under group");
		assert.equal(setUpAllItem.label, "(setUpAll)");
		assert.equal(fsPath(setUpAllItem.uri!), utilsPath);
		assert.equal(setUpAllItem.range?.start.line, 3);
		assert.equal(setUpAllItem.range?.start.character, 2);
		assert.equal(setUpAllItem.tags.some((tag) => tag.id === "DartRunnableTest"), false);

		assert.ok(userTestItem, "Expected user test item under group");
		assert.equal(userTestItem.label, "calls (setUpAll)");
		assert.equal(fsPath(userTestItem.uri!), suitePath);
		assert.equal(userTestItem.range?.start.line, 4);
		assert.equal(userTestItem.tags.some((tag) => tag.id === "DartRunnableTest"), true);

		checkTreeNodeResults(makeTestTextTree({ uriFilter: helloWorldRenameTestFile }).join("\n"), `
hello_world
    test/rename_test.dart [1/1 passed] Failed
        my group [1/1 passed] Failed
            (setUpAll) Failed (utils.dart)
            calls (setUpAll) Passed
		`);
	});

	it("disposes in-flight helper file range trackers if superseded or removed before openTextDocument resolves", async () => {
		await closeAllOpenFiles();

		const suitePath = fsPath(helloWorldRenameTestFile);
		const utilsPath = path.join(fsPath(helloWorldTestFolder), "utils.dart");
		const utilsUri = vs.Uri.file(utilsPath);
		const model = privateApi.testModel;
		model.suiteDiscovered("s1", suitePath);

		const initialRange = { end: { character: 2, line: 4 }, start: { character: 2, line: 3 } };
		model.testDiscovered("s1", suitePath, TestSource.Result, 1, "(setUpAll)", undefined, utilsPath, initialRange, undefined, false);
		const node = model.testDiscovered("s1", suitePath, TestSource.Result, 1, "(setUpAll)", undefined, utilsPath, initialRange, undefined, false);
		model.clearSuiteOrDirectory(suitePath);

		const utilsEditor = await openFile(utilsUri);
		defer("Revert utils.dart", async () => {
			await vs.window.showTextDocument(utilsEditor.document);
			await vs.commands.executeCommand("workbench.action.files.revert");
		});
		await utilsEditor.edit((e) => e.insert(new vs.Position(0, 0), "// line\n"));
		await delay(50);

		assert.equal(node.range?.start.line, 3);
	});

	it("normalizes Windows drive letters, slashes, and file URIs across notifications regardless of input casing", () => {
		sb.stub(constants, "isWin").value(true);
		const model = new TestModel(nullLogger, privateApi.workspaceContext, { dynamicTestTracking: false, showSkippedTests: true }, () => [], () => undefined);
		const winCoordinator = new TestSessionCoordinator(nullLogger, model, { getOutlineFor: () => undefined });

		winCoordinator.handleDebugSessionStart("d1", "s1", "d:/workspace/proj");
		const lowerCwdEvt: SuiteNotification = {
			suite: { id: 0, path: "test/my_test.dart", platform: "vm" },
			time: 0,
			type: "suite",
		};
		const fromLowerCwd = winCoordinator.normalizeNotification("s1", lowerCwdEvt) as SuiteNotification;
		assert.equal(fromLowerCwd.suite.path, "D:\\workspace\\proj\\test\\my_test.dart");

		winCoordinator.handleDebugSessionStart("d2", "s2", "D:\\workspace\\proj");
		for (const rawSuitePath of [
			"test\\my_test.dart",
			"d:/workspace/proj/test/my_test.dart",
			"D:\\workspace\\proj\\test\\my_test.dart",
		]) {
			const suiteEvt: SuiteNotification = {
				suite: { id: 0, path: rawSuitePath, platform: "vm" },
				time: 0,
				type: "suite",
			};
			const normalized = winCoordinator.normalizeNotification("s2", suiteEvt) as SuiteNotification;
			assert.equal(normalized.suite.path, "D:\\workspace\\proj\\test\\my_test.dart");
		}

		for (const [rawUtilsUri, expectedUtilsUri, rawRootUri, expectedRootUri] of [
			[
				"file:///d:/workspace/proj/test/utils.dart",
				"file:///D:/workspace/proj/test/utils.dart",
				"file:///d%3A/workspace/proj/test/my_test.dart",
				"file:///D%3A/workspace/proj/test/my_test.dart",
			],
			[
				"file:///D:/workspace/proj/test/utils.dart",
				"file:///D:/workspace/proj/test/utils.dart",
				"file:///D%3A/workspace/proj/test/my_test.dart",
				"file:///D%3A/workspace/proj/test/my_test.dart",
			],
		]) {
			const groupEvt = winCoordinator.normalizeNotification("s1", {
				group: {
					column: 3,
					id: 1,
					line: 4,
					name: "my group",
					root_column: undefined, // eslint-disable-line camelcase
					root_line: undefined, // eslint-disable-line camelcase
					root_url: rawRootUri, // eslint-disable-line camelcase
					suiteID: 0,
					testCount: 1,
					url: rawUtilsUri,
				},
				time: 1,
				type: "group",
			} as GroupNotification) as GroupNotification;
			assert.equal(groupEvt.group.url, expectedUtilsUri);
			assert.equal(groupEvt.group.root_url, expectedRootUri);

			const testEvt = winCoordinator.normalizeNotification("s1", {
				test: {
					column: 3,
					groupIDs: [1],
					id: 2,
					line: 5,
					name: "my group (setUpAll)",
					root_column: 5, // eslint-disable-line camelcase
					root_line: 6, // eslint-disable-line camelcase
					root_url: rawRootUri, // eslint-disable-line camelcase
					suiteID: 0,
					url: rawUtilsUri,
				},
				time: 2,
				type: "testStart",
			} as TestStartNotification) as TestStartNotification;
			assert.equal(testEvt.test.url, expectedUtilsUri);
			assert.equal(testEvt.test.root_url, expectedRootUri);
		}
	});

	it("resolves mixed uppercase and lowercase Windows drive letters end-to-end", async function () {
		if (!constants.isWin)
			this.skip();

		await openFile(helloWorldRenameTestFile);
		await setTestContent(`
import "package:test/test.dart";

void main() {
  group("my group", () {
    test("my test", () {
      expect(1, 1);
    });
  });
}
		`.trim());

		await waitFor(() => makeTestTextTree({ uriFilter: helloWorldRenameTestFile }).join("\n").includes("my test"));

		const cwd = fsPath(helloWorldFolder);
		const suitePath = fsPath(helloWorldRenameTestFile);
		const utilsPath = path.join(fsPath(helloWorldTestFolder), "utils.dart");
		const initialSuiteCount = privateApi.testModel.suites.size;

		const withLowerDrive = (p: string) => `${p.charAt(0).toLowerCase()}${p.slice(1)}`;
		const withUpperDrive = (p: string) => `${p.charAt(0).toUpperCase()}${p.slice(1)}`;
		const toUnencodedFileUri = (p: string, upperDrive: boolean) => {
			const raw = vs.Uri.file(p).toString(true);
			return raw.replace(/^file:\/\/\/([a-zA-Z]):\//, (_, d: string) => `file:///${upperDrive ? d.toUpperCase() : d.toLowerCase()}:/`);
		};
		const toEncodedFileUri = (p: string, upperDrive: boolean) => {
			const raw = vs.Uri.file(p).toString();
			return raw.replace(/^file:\/\/\/([a-zA-Z])%3A\//, (_, d: string) => `file:///${upperDrive ? d.toUpperCase() : d.toLowerCase()}%3A/`);
		};

		const coordinator = privateApi.testCoordinator;

		const runMixedCasingSession = (
			sessionSuffix: string,
			sessionCwd: string,
			sessionSuitePath: string,
			groupUrl: string,
			setUpAllUrl: string,
			setUpAllRootUrl: string,
			userTestUrl: string,
			userTestRootUrl: string,
		) => {
			const sessionID = `session-win-casing-${sessionSuffix}`;
			const debugSessionID = `dbg-win-casing-${sessionSuffix}`;
			defer(`End ${sessionID}`, () => {
				coordinator.handleDebugSessionEnd(debugSessionID, sessionID);
				privateApi.testController?.handleDebugSessionEnd({ configuration: { dartCodeDebugSessionID: sessionID } } as unknown as vs.DebugSession);
			});

			coordinator.handleDebugSessionStart(debugSessionID, sessionID, sessionCwd);
			coordinator.handleDebugSessionCustomEvent(debugSessionID, sessionID, "dart.testNotification", {
				suite: { id: 0, path: sessionSuitePath, platform: "vm" },
				time: 0,
				type: "suite",
			});
			coordinator.handleDebugSessionCustomEvent(debugSessionID, sessionID, "dart.testNotification", {
				group: { id: 2, name: "", parentID: undefined, suiteID: 0, testCount: 2 },
				time: 1,
				type: "group",
			});
			coordinator.handleDebugSessionCustomEvent(debugSessionID, sessionID, "dart.testNotification", {
				group: { column: 3, id: 4, line: 4, name: "my group", parentID: 2, suiteID: 0, testCount: 2, url: groupUrl },
				time: 2,
				type: "group",
			});
			coordinator.handleDebugSessionCustomEvent(debugSessionID, sessionID, "dart.testNotification", {
				test: {
					column: 3,
					groupIDs: [2, 4],
					id: 5,
					line: 4,
					name: "my group (setUpAll)",
					root_column: 3, // eslint-disable-line camelcase
					root_line: 4, // eslint-disable-line camelcase
					root_url: setUpAllRootUrl, // eslint-disable-line camelcase
					suiteID: 0,
					url: setUpAllUrl,
				},
				time: 3,
				type: "testStart",
			});
			coordinator.handleDebugSessionCustomEvent(debugSessionID, sessionID, "dart.testNotification", {
				hidden: true,
				result: "success",
				skipped: false,
				testID: 5,
				time: 4,
				type: "testDone",
			});
			coordinator.handleDebugSessionCustomEvent(debugSessionID, sessionID, "dart.testNotification", {
				test: {
					column: 3,
					groupIDs: [2, 4],
					id: 6,
					line: 10,
					name: "my group my test",
					root_column: 5, // eslint-disable-line camelcase
					root_line: 5, // eslint-disable-line camelcase
					root_url: userTestRootUrl, // eslint-disable-line camelcase
					suiteID: 0,
					url: userTestUrl,
				},
				time: 5,
				type: "testStart",
			});
			coordinator.handleDebugSessionCustomEvent(debugSessionID, sessionID, "dart.testNotification", {
				hidden: false,
				result: "success",
				skipped: false,
				testID: 6,
				time: 6,
				type: "testDone",
			});
			coordinator.handleDebugSessionEnd(debugSessionID, sessionID);
			privateApi.testController?.handleDebugSessionEnd({ configuration: { dartCodeDebugSessionID: sessionID } } as unknown as vs.DebugSession);

			assert.equal(privateApi.testModel.suites.size, initialSuiteCount);

			const suiteItem = findSuiteNode(suitePath);
			const groupItem = suiteItem.children.get(`GROUP:${suitePath}:my group`)!;
			const setUpAllItem = groupItem.children.get(`TEST:${suitePath}:my group (setUpAll)`)!;
			const userTestItem = groupItem.children.get(`TEST:${suitePath}:my group my test`)!;

			assert.equal(fsPath(setUpAllItem.uri!), utilsPath);
			assert.equal(fsPath(userTestItem.uri!), suitePath);
			assert.ok(userTestItem.range && userTestItem.range.end.line > userTestItem.range.start.line + 1, "Expected user test to match multi-line Outline range");

			checkTreeNodeResults(makeTestTextTree({ uriFilter: helloWorldRenameTestFile }).join("\n"), `
hello_world
    test/rename_test.dart [1/1 passed] Passed
        my group [1/1 passed] Passed
            (setUpAll) Passed (utils.dart)
            my test Passed
			`);
		};

		// Session 1: lowercase forward-slash cwd + relative suite.path + lowercase/uppercase encoded & unencoded URIs.
		runMixedCasingSession(
			"1",
			withLowerDrive(cwd).replace(/\\/g, "/"),
			"test/rename_test.dart",
			toUnencodedFileUri(suitePath, true),
			toUnencodedFileUri(utilsPath, false),
			toUnencodedFileUri(suitePath, true),
			toEncodedFileUri(utilsPath, false),
			toEncodedFileUri(suitePath, false),
		);

		// Session 2: uppercase cwd + absolute lowercase forward-slash suite.path + opposite URI casing.
		runMixedCasingSession(
			"2",
			withUpperDrive(cwd),
			withLowerDrive(suitePath).replace(/\\/g, "/"),
			toEncodedFileUri(suitePath, false),
			toEncodedFileUri(utilsPath, true),
			toEncodedFileUri(suitePath, false),
			toUnencodedFileUri(utilsPath, true),
			toUnencodedFileUri(suitePath, true),
		);
	});

	it("logs warnings when testDone, print, or error notifications reference a missing suite or test", () => {
		const warnings: unknown[] = [];
		const warnLogger: Logger = {
			error: (e: unknown) => assert.fail(`Unexpected error logged: ${String(e)}`),
			info: () => { },
			warn: (message: unknown) => { warnings.push(message); },
		};
		const model = new TestModel(warnLogger, privateApi.workspaceContext, { dynamicTestTracking: false, showSkippedTests: true }, () => [], () => undefined);
		const coordinator = new TestSessionCoordinator(warnLogger, model, { getOutlineFor: () => undefined });
		defer("Dispose test coordinator", () => coordinator.dispose());

		const sessionID = "session-missing";
		const debugSessionID = "dbg-missing";
		const suitePath = path.join(fsPath(helloWorldTestFolder), "missing_test.dart");
		coordinator.handleDebugSessionStart(debugSessionID, sessionID, fsPath(helloWorldFolder));

		const notifications = [
			{ hidden: false, result: "success", skipped: false, testID: 1, time: 1, type: "testDone" },
			{ message: "hello", messageType: "print", testID: 1, time: 2, type: "print" },
			{ error: "boom", isFailure: false, stackTrace: "stack", testID: 1, time: 3, type: "error" },
		];

		for (const evt of notifications)
			coordinator.handleDebugSessionCustomEvent(debugSessionID, sessionID, "dart.testNotification", evt);

		assert.deepStrictEqual(warnings, [
			`Could not find suite for test 1 for session ${sessionID}`,
			`Could not find suite for test 1 for session ${sessionID}`,
			`Could not find suite for test 1 for session ${sessionID}`,
		]);

		warnings.length = 0;
		coordinator.handleDebugSessionCustomEvent(debugSessionID, sessionID, "dart.testNotification", {
			suite: { id: 0, path: suitePath, platform: "vm" },
			time: 0,
			type: "suite",
		});
		coordinator.handleDebugSessionCustomEvent(debugSessionID, sessionID, "dart.testNotification", {
			test: { groupIDs: [], id: 1, name: "test 1", suiteID: 0 },
			time: 1,
			type: "testStart",
		});

		const suiteData = model.suites.getForPath(suitePath)!;
		sb.stub(suiteData, "getCurrentTest").returns(undefined);

		for (const evt of notifications)
			coordinator.handleDebugSessionCustomEvent(debugSessionID, sessionID, "dart.testNotification", evt);

		assert.deepStrictEqual(warnings, [
			`Could not find test 1 for session ${sessionID}`,
			`Could not find test 1 for session ${sessionID}`,
			`Could not find test 1 for session ${sessionID}`,
		]);
	});
});
