import { strict as assert } from "assert";
import * as fs from "fs";
import * as path from "path";
import * as vs from "vscode";
import { fsPath } from "../../../shared/utils/fs";
import { waitFor } from "../../../shared/utils/promises";
import { activate, checkTreeNodeResults, clearTestTree, defer, fakeCancellationToken, findProjectNode, getExpectedResults, helloWorldExampleSubFolder, helloWorldRenameTestFile, helloWorldTestDiscoveryFile, helloWorldTestDiscoveryLargeFile, helloWorldTestFolder, makeTestTextTree, openFile, privateApi, sb, setTestContent, tryDelete, waitForResult } from "../../helpers";

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

	function preventTestSpawning() {
		const executeCommand = sb.stub(vs.commands, "executeCommand").callThrough();
		executeCommand.withArgs("_dart.runAllTestsWithoutDebugging").resolves();
		executeCommand.withArgs("_dart.startDebuggingTestsFromVsTestController").resolves();
		executeCommand.withArgs("_dart.startWithoutDebuggingTestsFromVsTestController").resolves();
	}
});
