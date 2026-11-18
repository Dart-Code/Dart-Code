import { strict as assert } from "assert";
import * as vs from "vscode";
import { fsPath } from "../../../shared/utils/fs";
import { waitFor } from "../../../shared/utils/promises";
import { activate, checkTreeNodeResults, clearTestTree, defer, getPackages, helloWorldFolder, helloWorldRenameTestFile, makeTestTextTree, openFile, privateApi, sb, setTestContent } from "../../helpers";

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
    test/rename_test.dart [0/2 passed] Failed
        test 1 Unknown
        Failed to load Failed
		`);
	});
});
