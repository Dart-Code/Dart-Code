import { strict as assert } from "assert";
import { CoverageParser } from "../../../shared/test/coverage";
import { activate, extApi } from "../../helpers";

describe("coverage", () => {
	beforeEach("activate", () => activate());

	it("parses line and branch data correctly", async () => {
		const content = `
SF:lib\\main.dart
DA:1,1
# include a dupe with a zero to ensure that doesn't trip is up
DA:1,0
DA:2,2
DA:3,3
DA:4,0
DA:5,0
# Fake numbers because we can't use these for Dart because they exclude "branch lines"
LF:100
LH:1000
BRDA:1,0,0,0
BRDA:2,0,0,0
BRDA:4,0,0,0
BRDA:5,0,0,1
BRDA:6,0,0,0
BRDA:7,0,0,1
BRDA:8,0,0,2
end_of_record
SF:lib\\main2.dart
DA:4,0
end_of_record
		`.trim();

		const parser = new CoverageParser(extApi.logger);
		const results = parser.parseLcovContent(content);

		assert.equal(results.length, 2);
		const result1 = results[0];
		const result2 = results[1];

		assert.equal(result1.sourceFilePath, "lib\\main.dart");
		assert.deepStrictEqual(result1.coverableLines, new Set<number>([1, 2, 3, 4, 5, 6, 7, 8]));
		assert.deepStrictEqual(result1.coveredLines, new Set<number>([1, 2, 3, 5, 7, 8]));

		assert.equal(result2.sourceFilePath, "lib\\main2.dart");
		assert.deepStrictEqual(result2.coverableLines, new Set<number>([4]));
		assert.deepStrictEqual(result2.coveredLines, new Set<number>([]));
	});
});
