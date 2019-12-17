import * as assert from "assert";
import { waitFor } from "../../../shared/utils/promises";
import { activate, extApi, flutterHelloWorldOutlineFile, getExpectedResults, getPackages, makeTextTree, openFile, waitForResult } from "../../helpers";

describe("flutter_outline", () => {
	// We have tests that require external packages.
	before("get packages", () => getPackages());
	before("activate", () => activate());

	it("renders the expected tree", async () => {
		assert.ok(extApi.flutterOutlineTreeProvider);

		await openFile(flutterHelloWorldOutlineFile);
		await waitForResult(() => !!extApi.fileTracker.getOutlineFor(flutterHelloWorldOutlineFile));

		// Wait until we get some child nodes so we know the outline has been processed.
		await waitFor(async () => {
			const res = await extApi.flutterOutlineTreeProvider!.getChildren(undefined);
			return res && res.length;
		});

		const expectedResults = getExpectedResults();
		const actualResults = (await makeTextTree(undefined, extApi.flutterOutlineTreeProvider!)).join("\n");

		assert.ok(expectedResults, "Expected results were empty");
		assert.ok(actualResults, "Actual results were empty");
		assert.equal(actualResults, expectedResults);
	});
});
