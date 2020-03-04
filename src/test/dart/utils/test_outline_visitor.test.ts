import * as assert from "assert";
import { Outline } from "../../../shared/analysis_server_types";
import { fsPath } from "../../../shared/utils/fs";
import { TestOutlineVisitor } from "../../../shared/utils/outline_das";
import { LspTestOutlineVisitor } from "../../../shared/utils/outline_lsp";
import { activate, extApi, getPackages, helloWorldTestMainFile, logger, waitForResult } from "../../helpers";

describe("test_outline_visitor", () => {

	before("get packages", () => getPackages());
	beforeEach("activate and wait for outline", async () => {
		await activate(helloWorldTestMainFile);
		await waitForResult(() => !!extApi.fileTracker.getOutlineFor(helloWorldTestMainFile));
	});

	it("reads the correct groups and tests", () => {
		const outline = extApi.fileTracker.getOutlineFor(helloWorldTestMainFile) as Outline | undefined;
		if (!outline)
			throw new Error(`Did not get outline for ${helloWorldTestMainFile}`);

		const visitor = extApi.isLsp ? new LspTestOutlineVisitor(logger, fsPath(helloWorldTestMainFile)) : new TestOutlineVisitor(logger);
		visitor.visit(outline as any); // TODO: Remove when we don't have two outlines

		assert.equal(visitor.tests.length, 7);
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
	});
});
