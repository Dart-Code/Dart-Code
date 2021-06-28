import { strict as assert } from "assert";
import { activate, extApi, getExpectedResults, helloWorldTestDiscoveryFile, makeTextTree, openFile, waitForResult } from "../../helpers";

describe("dart test tree", () => {
	beforeEach("activate", () => activate());

	it("discovers test when opening a file", async function () {
		// Discovery is only supported for LSP.
		if (!extApi.isLsp)
			this.skip();

		// Ensure no results before we start.
		const initialResults = (await makeTextTree(helloWorldTestDiscoveryFile, extApi.testTreeProvider)).join("\n");
		assert.equal(initialResults, "");

		// Open the file and allow time for the outline.
		await openFile(helloWorldTestDiscoveryFile);
		await waitForResult(() => !!extApi.fileTracker.getOutlineFor(helloWorldTestDiscoveryFile));

		const expectedResults = getExpectedResults();
		const actualResults = (await makeTextTree(helloWorldTestDiscoveryFile, extApi.testTreeProvider)).join("\n");

		assert.ok(expectedResults);
		assert.ok(actualResults);
		assert.equal(actualResults, expectedResults);
	});

});
