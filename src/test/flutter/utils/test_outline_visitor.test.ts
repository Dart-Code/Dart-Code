import { strict as assert } from "assert";
import { fsPath } from "../../../shared/utils/fs";
import { TestOutlineVisitor } from "../../../shared/utils/outline";
import { activate, flutterTestOtherFile, getPackages, logger, privateApi, waitForResult } from "../../helpers";

describe("test_outline_visitor", () => {
	before("get packages", () => getPackages());
	beforeEach("activate and wait for outline", async () => {
		await activate(flutterTestOtherFile);
		await waitForResult(() => !!privateApi.fileTracker.getOutlineFor(flutterTestOtherFile));
	});

	it("reads the correct groups and tests", () => {
		const outline = privateApi.fileTracker.getOutlineFor(flutterTestOtherFile)!;

		const visitor = new TestOutlineVisitor(logger, fsPath(flutterTestOtherFile));
		visitor.visit(outline);

		assert.equal(visitor.tests.length, 2);
		assert.equal(visitor.tests[0].isGroup, true);
		assert.equal(visitor.tests[0].fullName, "Other tests group");
		assert.equal(visitor.tests[1].isGroup, false);
		assert.equal(visitor.tests[1].fullName, "Other tests group Other test");
	});
});
