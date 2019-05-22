import * as assert from "assert";
import { OpenFileTracker } from "../../../extension/analysis/open_file_tracker";
import { TestOutlineVisitor } from "../../../extension/utils/vscode/outline";
import { activate, extApi, flutterTestOtherFile, getPackages, waitForResult } from "../../helpers";

describe("test_outline_visitor", () => {
	before("get packages", () => getPackages());
	beforeEach("activate and wait for outline", async () => {
		await activate(flutterTestOtherFile);
		await waitForResult(() => !!OpenFileTracker.getOutlineFor(flutterTestOtherFile));
	});

	it("reads the correct groups and tests", function () {
		if (!extApi.flutterCapabilities.hasTestGroupFix) {
			this.skip();
			return;
		}

		const outline = OpenFileTracker.getOutlineFor(flutterTestOtherFile);

		const visitor = new TestOutlineVisitor();
		visitor.visit(outline);

		assert.equal(visitor.tests.length, 2);
		assert.equal(visitor.tests[0].isGroup, true);
		assert.equal(visitor.tests[0].fullName, "Other tests group");
		assert.equal(visitor.tests[1].isGroup, false);
		assert.equal(visitor.tests[1].fullName, "Other tests group Other test");
	});
});
