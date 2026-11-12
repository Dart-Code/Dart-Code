import { strict as assert } from "assert";
import { fsPath } from "../../../shared/utils/fs";
import { TestOutlineVisitor } from "../../../shared/utils/outline";
import { parseTestNameFromOutline } from "../../../shared/utils/test";
import { activate, getExpectedOutline, getPackages, helloWorldTestDiscoveryFile, helloWorldTestDynamicFile, helloWorldTestMainFile, logger, openFile } from "../../helpers";

describe("test_outline_visitor", () => {

	before("get packages", () => getPackages());
	beforeEach("activate", () => activate(helloWorldTestMainFile));

	it("reads the correct groups and tests", async () => {
		const outline = await getExpectedOutline();

		const visitor = new TestOutlineVisitor(logger, fsPath(helloWorldTestMainFile));
		visitor.visit(outline);

		assert.equal(visitor.tests.length, 12);
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
		assert.equal(visitor.tests[11].isGroup, false);
		assert.equal(visitor.tests[11].fullName, "ensure coverage data");
	});

	it("marks tests inside nested local functions as not from main()", async () => {
		// dynamic_test.dart declares customTest() inside main(), and customTest's
		// body contains a test() call. That inner test is not a main() test, but
		// tests appearing after the local function in main() still are.
		await openFile(helloWorldTestDynamicFile);
		const outline = await getExpectedOutline();

		const visitor = new TestOutlineVisitor(logger, fsPath(helloWorldTestDynamicFile));
		visitor.visit(outline);

		const notFromMain = visitor.tests.filter((test) => test.isOutlineNodeNotFromMainFunction);
		assert.ok(notFromMain.length > 0, "expected tests inside nested local functions to be flagged");
		assert.ok(
			notFromMain.every((test) => test.fullName.includes("extra text")),
			`expected only the customTest body test to be flagged, got ${JSON.stringify(notFromMain.map((t) => t.fullName))}`,
		);

		const fromMain = visitor.tests.filter((test) => !test.isOutlineNodeNotFromMainFunction);
		assert.ok(fromMain.length > 0, "expected tests directly inside main() to remain unflagged");
	});

	it("classifies tests in top-level and nested helpers against discovery_test.dart", async () => {
		// discovery_test.dart contains a top-level helperWithTests() outside
		// main(), a nestedHelper() local function inside main() followed by a
		// regular test, and regular groups/tests inside main().
		await openFile(helloWorldTestDiscoveryFile);
		const outline = await getExpectedOutline();

		const visitor = new TestOutlineVisitor(logger, fsPath(helloWorldTestDiscoveryFile));
		visitor.visit(outline);

		assert.deepStrictEqual(
			visitor.tests.map((test) => ({
				fullName: test.fullName,
				isGroup: test.isGroup,
				isOutlineNodeNotFromMainFunction: test.isOutlineNodeNotFromMainFunction,
			})),
			[
				{ fullName: "group 1", isGroup: true, isOutlineNodeNotFromMainFunction: false },
				{ fullName: "group 1 test 1", isGroup: false, isOutlineNodeNotFromMainFunction: false },
				{ fullName: "group 1 test interpolated ${1 + 1}", isGroup: false, isOutlineNodeNotFromMainFunction: false },
				{ fullName: "group interpolated ${1 + 1}", isGroup: true, isOutlineNodeNotFromMainFunction: false },
				{ fullName: "group interpolated ${1 + 1} test 1", isGroup: false, isOutlineNodeNotFromMainFunction: false },
				{ fullName: "test 1", isGroup: false, isOutlineNodeNotFromMainFunction: false },
				{ fullName: "nested helper test", isGroup: false, isOutlineNodeNotFromMainFunction: true },
				{ fullName: "after nested helper", isGroup: false, isOutlineNodeNotFromMainFunction: false },
				{ fullName: "helper group", isGroup: true, isOutlineNodeNotFromMainFunction: true },
				{ fullName: "helper group helper test", isGroup: false, isOutlineNodeNotFromMainFunction: true },
				{ fullName: "another helper test", isGroup: false, isOutlineNodeNotFromMainFunction: true },
			],
		);
	});

	it("distinguishes literal dollar signs from interpolated test names in outlines", () => {
		// Unquoted descriptions come from analyzer stringValue (fixed strings,
		// including escaped \$ and raw r'...' strings).
		assert.deepStrictEqual(parseTestNameFromOutline(`group("price $5")`), { isDynamic: false, name: "price $5" });
		assert.deepStrictEqual(parseTestNameFromOutline(`group("price $foo")`), { isDynamic: false, name: "price $foo" });
		assert.deepStrictEqual(parseTestNameFromOutline(`group("price \${1 + 1}")`), { isDynamic: false, name: "price ${1 + 1}" });

		// Quote-wrapped descriptions come from analyzer toSource() fallback for interpolations.
		assert.deepStrictEqual(parseTestNameFromOutline(`group("'group $testType'")`), { isDynamic: true, name: "group $testType" });
		assert.deepStrictEqual(parseTestNameFromOutline(`group(""group \${1 + 1}"")`), { isDynamic: true, name: "group ${1 + 1}" });
		assert.deepStrictEqual(parseTestNameFromOutline(`group("r'group ' '$testType'")`), { isDynamic: true, name: "r'group ' '$testType'" });

		// Edge cases: partial quotes, single-quote names, empty/malformed inputs.
		assert.deepStrictEqual(parseTestNameFromOutline(`test("with quotes ">= foo"")`), { isDynamic: false, name: `with quotes ">= foo"` });
		assert.deepStrictEqual(parseTestNameFromOutline(`test("'")`), { isDynamic: false, name: "'" });
		assert.equal(parseTestNameFromOutline(""), undefined);
		assert.equal(parseTestNameFromOutline("invalid"), undefined);
	});
});
