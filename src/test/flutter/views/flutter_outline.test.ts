import { strict as assert } from "assert";
import { waitFor } from "../../../shared/utils/promises";
import { activate, checkTreeNodeResults, flutterHelloWorldOutlineFile, getExpectedResults, getPackages, makeTextTreeUsingCustomTree, openFile, privateApi, waitForResult } from "../../helpers";

describe("flutter_outline", () => {
	// We have tests that require external packages.
	before("get packages", () => getPackages());
	before("activate", () => activate());

	it("renders the expected tree", async () => {
		assert.ok(privateApi.flutterOutlineTreeProvider);

		await openFile(flutterHelloWorldOutlineFile);
		await waitForResult(() => !!privateApi.fileTracker.getFlutterOutlineFor!(flutterHelloWorldOutlineFile));

		// Wait until we get some child nodes so we know the outline has been processed.
		await waitFor(async () => {
			const res = await privateApi.flutterOutlineTreeProvider!.getChildren(undefined);
			return res?.length;
		});

		const expectedResults = getExpectedResults();
		const actualResults = (await makeTextTreeUsingCustomTree(undefined, privateApi.flutterOutlineTreeProvider)).join("\n");

		assert.ok(expectedResults, "Expected results were empty");
		assert.ok(actualResults, "Actual results were empty");
		checkTreeNodeResults(actualResults, expectedResults);
	});
});
