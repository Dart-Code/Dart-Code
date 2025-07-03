import { strict as assert } from "assert";
import { waitFor } from "../../../shared/utils/promises";
import { activate, checkTreeNodeResults, extApi, flutterHelloWorldOutlineFile, getExpectedResults, getPackages, makeTextTreeUsingCustomTree, openFile, waitForResult } from "../../helpers";

describe("flutter_outline", () => {
	// We have tests that require external packages.
	before("get packages", () => getPackages());
	before("activate", () => activate());

	it("renders the expected tree", async () => {
		assert.ok(extApi.flutterOutlineTreeProvider);

		await openFile(flutterHelloWorldOutlineFile);
		await waitForResult(() => !!extApi.fileTracker.getFlutterOutlineFor!(flutterHelloWorldOutlineFile));

		// Wait until we get some child nodes so we know the outline has been processed.
		await waitFor(async () => {
			const res = await extApi.flutterOutlineTreeProvider!.getChildren(undefined);
			return res?.length;
		});

		const expectedResults = getExpectedResults();
		const actualResults = (await makeTextTreeUsingCustomTree(undefined, extApi.flutterOutlineTreeProvider)).join("\n");

		assert.ok(expectedResults, "Expected results were empty");
		assert.ok(actualResults, "Actual results were empty");
		checkTreeNodeResults(actualResults, expectedResults);
	});
});
