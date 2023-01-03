import { strict as assert } from "assert";
import { activate, checkTreeNodeResults, delay, extApi, getExpectedResults, helloWorldTestDiscoveryFile, helloWorldTestDiscoveryLargeFile, makeTestTextTree, openFile, waitForResult } from "../../helpers";

describe("dart tests", () => {
	beforeEach("activate", () => activate());

	it("discovers test when opening a file", async function () {
		// Discovery is only supported for LSP.
		if (!extApi.isLsp)
			this.skip();

		// Ensure no results before we start.
		const initialResults = makeTestTextTree(helloWorldTestDiscoveryFile).join("\n");
		assert.equal(initialResults, "");

		// Open the file and allow time for the outline.
		await openFile(helloWorldTestDiscoveryFile);
		await waitForResult(() => !!extApi.fileTracker.getOutlineFor(helloWorldTestDiscoveryFile));

		await delay(1500); // Account for debounce.

		const expectedResults = getExpectedResults();
		const actualResults = makeTestTextTree(helloWorldTestDiscoveryFile).join("\n");

		assert.ok(expectedResults);
		assert.ok(actualResults);
		checkTreeNodeResults(actualResults, expectedResults);
	});

	it("discovers a large number of tests in a reasonable time", async function () {
		if (!extApi.isLsp)
			this.skip();

		// Ensure no results before we start.
		const initialResults = makeTestTextTree(helloWorldTestDiscoveryLargeFile).join("\n");
		assert.equal(initialResults, "");

		// Open the file and allow time for the outline.
		const startTime = process.hrtime();
		await openFile(helloWorldTestDiscoveryLargeFile);
		await waitForResult(() => !!extApi.fileTracker.getOutlineFor(helloWorldTestDiscoveryLargeFile));

		await delay(1500); // Account for debounce.

		const testTree = makeTestTextTree(helloWorldTestDiscoveryLargeFile);
		assert.equal(testTree.length, 1250 /* tests */ + 5 /* groups */ + 1 /* file */);
		const timeTaken = process.hrtime(startTime);
		const timeTakenMs = Math.round(timeTaken[0] * 1000 + timeTaken[1] / 1000000);

		// This outout needs to be high enough to not trigger on slow bots like GH Actions. If
		// this test ends up flaky, we may need tweak it (or use `allowSlowSubscriptionTests`).
		assert.ok(timeTakenMs < 5000, `Took ${timeTakenMs}ms to discover tests`);
	});

});
