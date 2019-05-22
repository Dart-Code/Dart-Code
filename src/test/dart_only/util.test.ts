import * as assert from "assert";
import * as path from "path";
import { isDartSdkFromFlutter, isStableSdk, versionIsAtLeast } from "../../shared/utils";

describe("versionIsAtLeast", () => {
	it("should not consider build numbers when comparing versions", () => {
		assert.equal(versionIsAtLeast("1.2.3", "1.2.3"), true);
		assert.equal(versionIsAtLeast("1.2.3+012345", "1.2.3"), true);
	});
	it("should consider pre-release versions older than release versions", () => {
		assert.equal(versionIsAtLeast("1.2.3-alpha", "1.2.3"), false);
		assert.equal(versionIsAtLeast("1.2.3-alpha+012345", "1.2.3"), false);
	});
	it("should compare segments as individual numbers, not decimals", () => {
		assert.equal(versionIsAtLeast("1.9.0", "1.10.0"), false);
	});
	it("should return the correct result for some real world tests", () => {
		assert.equal(versionIsAtLeast("1.2.0", "1.18.1"), false);
		assert.equal(versionIsAtLeast("1.18.0", "1.18.1"), false);
		assert.equal(versionIsAtLeast("1.18.1", "1.18.1"), true);
		assert.equal(versionIsAtLeast("1.19.0", "1.18.1"), true);
		assert.equal(versionIsAtLeast("1.19.0-dev.0.0", "1.18.1"), true);
		assert.equal(versionIsAtLeast("1.19.0-dev.5.0", "1.18.1"), true);
		assert.equal(versionIsAtLeast("1.19.0-dev.7.0", "1.18.1"), true);
		assert.equal(versionIsAtLeast("1.19.1-dev.0.0", "1.19.0"), true);
		assert.equal(versionIsAtLeast("0.10.2-pre.119", "0.10.2"), false);
		assert.equal(versionIsAtLeast("0.10.1", "0.10.2-a"), false);
		assert.equal(versionIsAtLeast("0.10.1-pre.119", "0.10.2-a"), false);
		assert.equal(versionIsAtLeast("0.10.2-pre.119", "0.10.2-a"), true);
		assert.equal(versionIsAtLeast("0.10.3-pre.119", "0.10.2-a"), true);
		assert.equal(versionIsAtLeast("0.10.2-alpha.1", "0.10.2-a"), true);
		assert.equal(versionIsAtLeast("0.10.2-beta.1", "0.10.2-a"), true);
		assert.equal(versionIsAtLeast("2.2.0", "2.2.1-edge"), false);
		assert.equal(versionIsAtLeast("2.2.1-dev", "2.2.1-edge"), false);
		assert.equal(versionIsAtLeast("2.2.1-dev.1", "2.2.1-edge"), false);
		assert.equal(versionIsAtLeast("2.2.1-edge", "2.2.1-edge"), true);
		assert.equal(versionIsAtLeast("2.2.1-edge.foo", "2.2.1-edge"), true);
	});
});

describe("isStableSdk", () => {
	it("should consider missing versions as unstable", () => {
		assert.equal(isStableSdk(), false);
		assert.equal(isStableSdk(undefined), false);
	});
	it("should consider anything without a hyphen as stable", () => {
		assert.equal(isStableSdk("1.0.0"), true);
		assert.equal(isStableSdk("1.2.0"), true);
		assert.equal(isStableSdk("1.2.3"), true);
	});
	it("should consider anything with a hyphen as unstable", () => {
		assert.equal(isStableSdk("1.0.0-dev"), false);
		assert.equal(isStableSdk("1.2.0-beta"), false);
		assert.equal(isStableSdk("1.2.3-alpha.3"), false);
		assert.equal(isStableSdk("0.2.2-pre.55"), false);
		assert.equal(isStableSdk("2.0.0-dev.37.0.flutter-7328726088"), false);
	});
});

describe("util.isDartSdkFromFlutter", () => {
	it("should consider Dart SDK to not be from Flutter", function () {
		if (!process.env.DART_PATH) {
			this.skip();
			return;
		}

		assert.equal(isDartSdkFromFlutter(process.env.DART_PATH), false);
	});
	it("should consider Flutter's Dart SDK to be from Flutter", function () {
		if (!process.env.FLUTTER_PATH) {
			this.skip();
			return;
		}

		assert.equal(isDartSdkFromFlutter(path.join(process.env.FLUTTER_PATH, "bin", "cache", "dart-sdk")), true);
	});
});
