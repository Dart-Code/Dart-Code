import * as assert from "assert";
import * as util from "../../src/utils";

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

describe("util.isStableSdk", () => {
	it("should consider missing versions as unstable", () => {
		assert.equal(util.isStableSdk(), false);
		assert.equal(util.isStableSdk(undefined), false);
	});
	it("should consider anything without a hyphen as stable", () => {
		assert.equal(util.isStableSdk("1.0.0"), true);
		assert.equal(util.isStableSdk("1.2.0"), true);
		assert.equal(util.isStableSdk("1.2.3"), true);
	});
	it("should consider anything with a hyphen as unstable", () => {
		assert.equal(util.isStableSdk("1.0.0-dev"), false);
		assert.equal(util.isStableSdk("1.2.0-beta"), false);
		assert.equal(util.isStableSdk("1.2.3-alpha.3"), false);
		assert.equal(util.isStableSdk("0.2.2-pre.55"), false);
		assert.equal(util.isStableSdk("2.0.0-dev.37.0.flutter-7328726088"), false);
	});
});
