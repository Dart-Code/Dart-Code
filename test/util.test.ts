import * as assert from "assert";
import * as util from "../src/utils";

describe("util.versionIsAtLeast", () => {
	it("should not consider build numbers when comparing versions", () => {
		assert.equal(util.versionIsAtLeast("1.2.3", "1.2.3"), true);
		assert.equal(util.versionIsAtLeast("1.2.3+012345", "1.2.3"), true);
	});
	it("should consider pre-release versions older than release versions", () => {
		assert.equal(util.versionIsAtLeast("1.2.3-alpha", "1.2.3"), false);
		assert.equal(util.versionIsAtLeast("1.2.3-alpha+012345", "1.2.3"), false);
	});
	it("should compare segments as individual numbers, not decimals", () => {
		assert.equal(util.versionIsAtLeast("1.9.0", "1.10.0"), false);
	});
	it("should return the correct result for some real world tests", () => {
		assert.equal(util.versionIsAtLeast("1.2.0", "1.18.1"), false);
		assert.equal(util.versionIsAtLeast("1.18.0", "1.18.1"), false);
		assert.equal(util.versionIsAtLeast("1.18.1", "1.18.1"), true);
		assert.equal(util.versionIsAtLeast("1.19.0", "1.18.1"), true);
		assert.equal(util.versionIsAtLeast("1.19.0-dev.0.0", "1.18.1"), true);
		assert.equal(util.versionIsAtLeast("1.19.0-dev.5.0", "1.18.1"), true);
		assert.equal(util.versionIsAtLeast("1.19.0-dev.7.0", "1.18.1"), true);
		assert.equal(util.versionIsAtLeast("1.19.1-dev.0.0", "1.19.0"), true);
	});
});
