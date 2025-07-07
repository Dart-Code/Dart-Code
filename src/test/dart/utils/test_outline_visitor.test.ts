import { strict as assert } from "assert";
import { fsPath } from "../../../shared/utils/fs";
import { TestOutlineVisitor } from "../../../shared/utils/outline";
import { activate, getPackages, helloWorldTestMainFile, logger, privateApi, waitForResult } from "../../helpers";

describe("test_outline_visitor", () => {

	before("get packages", () => getPackages());
	beforeEach("activate and wait for outline", async () => {
		await activate(helloWorldTestMainFile);
		await waitForResult(() => !!privateApi.fileTracker.getOutlineFor(helloWorldTestMainFile));
	});

	it("reads the correct groups and tests", () => {
		const outline = privateApi.fileTracker.getOutlineFor(helloWorldTestMainFile);
		if (!outline)
			throw new Error(`Did not get outline for ${helloWorldTestMainFile}`);

		const visitor = new TestOutlineVisitor(logger, fsPath(helloWorldTestMainFile));
		visitor.visit(outline);

		assert.equal(visitor.tests.length, 11);
		assert.equal(visitor.tests[0].isGroup, true);
		assert.equal(visitor.tests[0].fullName, "String");
		assert.equal(visitor.tests[1].isGroup, false);
		assert.equal(visitor.tests[1].fullName, "String .split() splits the string on the delimiter");
		assert.equal(visitor.tests[2].isGroup, false);
		assert.equal(visitor.tests[2].fullName, "String .split() splits the string on the delimiter 2");
		assert.equal(visitor.tests[3].isGroup, false);
		assert.equal(visitor.tests[3].fullName, "String .trim() removes surrounding whitespace");

		assert.equal(visitor.tests[4].isGroup, true);
		assert.equal(visitor.tests[4].fullName, "int");
		assert.equal(visitor.tests[5].isGroup, false);
		assert.equal(visitor.tests[5].fullName, "int .remainder() returns the remainder of division");
		assert.equal(visitor.tests[6].isGroup, false);
		assert.equal(visitor.tests[6].fullName, "int .toRadixString() returns a hex string");

		assert.equal(visitor.tests[7].isGroup, true);
		assert.equal(visitor.tests[7].fullName, "greater than");
		assert.equal(visitor.tests[8].isGroup, false);
		assert.equal(visitor.tests[8].fullName, "greater than without quotes List<String>");
		assert.equal(visitor.tests[9].isGroup, false);
		assert.equal(visitor.tests[9].fullName, `greater than with quotes ">= foo"`);
		assert.equal(visitor.tests[10].isGroup, false);
		assert.equal(visitor.tests[10].fullName, "`with backticks`");
	});
});
