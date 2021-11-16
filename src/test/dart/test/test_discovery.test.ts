import { strict as assert } from "assert";
import { activate, checkTreeNodeResults, delay, extApi, getExpectedResults, helloWorldTestDiscoveryFile, makeTestTextTree, openFile, waitForResult } from "../../helpers";

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

});
