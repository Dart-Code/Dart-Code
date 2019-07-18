import * as assert from "assert";
import { activate, extApi, flutterHelloWorldOutlineFile, getExpectedResults, getPackages, makeTextTree, openFile, waitForResult } from "../../helpers";

describe("flutter_outline", () => {
	// We have tests that require external packages.
	before("get packages", () => getPackages());
	before("activate", () => activate());

	it("renders the expected tree", async () => {
		assert.ok(extApi.flutterOutlineTreeProvider);

		await openFile(flutterHelloWorldOutlineFile);
		await waitForResult(() => !!extApi.fileTracker.getOutlineFor(flutterHelloWorldOutlineFile));

		const expectedResults = getExpectedResults();
		const actualResults = (await makeTextTree(undefined, extApi.flutterOutlineTreeProvider)).join("\n");

		assert.ok(expectedResults);
		assert.ok(actualResults);
		assert.equal(actualResults, expectedResults);
	});
});
