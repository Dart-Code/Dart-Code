import * as assert from "assert";
import { TestOutlineVisitor } from "../../../shared/utils/outline_das";
import { activate, extApi, flutterTestOtherFile, getPackages, logger, waitForResult } from "../../helpers";

describe("test_outline_visitor", () => {
	before("get packages", () => getPackages());
	beforeEach("activate and wait for outline", async () => {
		await activate(flutterTestOtherFile);
		await waitForResult(() => !!extApi.fileTracker.getOutlineFor(flutterTestOtherFile));
	});

	it("reads the correct groups and tests", function () {
		if (!extApi.flutterCapabilities.hasTestGroupFix) {
			this.skip();
			return;
		}

		const outline = extApi.fileTracker.getOutlineFor(flutterTestOtherFile);

		const visitor = new TestOutlineVisitor(logger);
		visitor.visit(outline!);

		assert.equal(visitor.tests.length, 2);
		assert.equal(visitor.tests[0].isGroup, true);
		assert.equal(visitor.tests[0].fullName, "Other tests group");
		assert.equal(visitor.tests[1].isGroup, false);
		assert.equal(visitor.tests[1].fullName, "Other tests group Other test");
	});
});
