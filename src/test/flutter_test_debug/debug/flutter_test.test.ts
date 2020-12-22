import * as assert from "assert";
import * as path from "path";
import * as vs from "vscode";
import { DebuggerType, VmServiceExtension } from "../../../shared/enums";
import { fsPath } from "../../../shared/utils/fs";
import { waitFor } from "../../../shared/utils/promises";
import { DartDebugClient } from "../../dart_debug_client";
import { createDebugClient, killFlutterTester, startDebugger, waitAllThrowIfTerminates } from "../../debug_helpers";
import { activate, deferUntilLast, extApi, flutterHelloWorldFolder, flutterTestAnotherFile, flutterTestBrokenFile, flutterTestDriverAppFile, flutterTestDriverTestFile, flutterTestMainFile, flutterTestOtherFile, getExpectedResults, getPackages, makeTextTree, openFile, positionOf, watchPromise } from "../../helpers";

describe("flutter test debugger", () => {

	// We don't commit all the iOS/Android stuff to this repo to save space, but we can bring it back with
	// `flutter create .`!
	before("run 'flutter create'", () => vs.commands.executeCommand("_flutter.create", fsPath(flutterHelloWorldFolder)));
	// We have tests that require external packages.
	before("get packages", () => getPackages());
	beforeEach("activate flutterTestMainFile", async () => {
		await activate(flutterTestMainFile);
	});

	beforeEach(() => {
		deferUntilLast(() => watchPromise("Killing flutter_tester processes", killFlutterTester()));
	});

	let dc: DartDebugClient;
	beforeEach("create debug client", () => {
		dc = createDebugClient(DebuggerType.FlutterTest);
	});

	it("runs a Flutter test script to completion", async () => {
		const config = await startDebugger(dc, flutterTestMainFile);
		await waitAllThrowIfTerminates(dc,
			dc.configurationSequence(),
			dc.waitForEvent("terminated"),
			dc.launch(config),
		);
	});

	it("receives the expected events from a Flutter test script", async () => {
		const config = await startDebugger(dc, flutterTestMainFile);
		await waitAllThrowIfTerminates(dc,
			dc.configurationSequence(),
			dc.assertOutputContains("stdout", `✓ Hello world test`),
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
			dc.assertOutputContains("stdout", `✓ Hello world test`),
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
			dc.assertOutputContains("stdout", `✓ Other tests group Other test\n`),
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
			dc.assertOutputContains("stdout", `✓ Other tests group Other test\n`),
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

		const topLevelNodes = await extApi.testTreeProvider.getChildren();
		assert.ok(topLevelNodes);
		assert.equal(topLevelNodes.length, testFiles.length);

		for (const file of testFiles) {
			await openFile(file);
			const expectedResults = getExpectedResults();
			const actualResults = (await makeTextTree(file, extApi.testTreeProvider)).join("\n");

			assert.ok(expectedResults);
			assert.ok(actualResults);
			assert.equal(actualResults, expectedResults);
		}
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

		const variables = await dc.getTopFrameVariables("Exception");
		assert.ok(variables);
		const v = variables.find((v) => v.name === "message");
		assert.ok(v);
		assert.equal(v.evaluateName, "$e.message");
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

	it("can run test_driver tests", async () => {
		// Start the instrumented app.
		const appDc = createDebugClient(DebuggerType.Flutter);
		const appConfig = await startDebugger(appDc, flutterTestDriverAppFile);
		appConfig.noDebug = true;
		await waitAllThrowIfTerminates(appDc,
			appDc.configurationSequence(),
			appDc.launch(appConfig),
		);

		// Allow some time for the debug service to register its Driver extension so we can find it when
		// looking for the app debug session later.
		await waitFor(() => extApi.debugSessions.find((s) => s.loadedServiceExtensions.indexOf(VmServiceExtension.Driver) !== -1));

		// Run the integration tests
		const config = await startDebugger(dc, flutterTestDriverTestFile);
		config.noDebug = true;
		await waitAllThrowIfTerminates(dc,
			dc.configurationSequence(),
			dc.assertPassingTest(`Counter App increments the counter`),
			dc.launch(config),
		);
	});
});
