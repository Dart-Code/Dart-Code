"use strict";

import * as path from "path";;
import * as assert from 'assert';
import * as util from '../src/utils';

describe("util.isOutOfDate", () => {
	it("should not consider build numbers when comparing versions", () => {
		assert.equal(util.isOutOfDate("1.2.3", "1.2.3"), false);
		assert.equal(util.isOutOfDate("1.2.3+012345", "1.2.3"), false);
	});
	it("should consider pre-release versions older than release versions", () => {
		assert.equal(util.isOutOfDate("1.2.3-alpha", "1.2.3"), true);
		assert.equal(util.isOutOfDate("1.2.3-alpha+012345", "1.2.3"), true);
	});
	it("should compare segments as individual numbers, not decimals", () => {
		assert.equal(util.isOutOfDate("1.9.0", "1.10.0"), true);
	});
	it("should return the correct result for some real world tests", () => {
		assert.equal(util.isOutOfDate("1.2.0", "1.18.1"), true);
		assert.equal(util.isOutOfDate("1.18.0", "1.18.1"), true);
		assert.equal(util.isOutOfDate("1.18.1", "1.18.1"), false);
		assert.equal(util.isOutOfDate("1.19.0", "1.18.1"), false);
		assert.equal(util.isOutOfDate("1.19.0-dev.0.0", "1.18.1"), false);
		assert.equal(util.isOutOfDate("1.19.0-dev.5.0", "1.18.1"), false);
		assert.equal(util.isOutOfDate("1.19.0-dev.7.0", "1.18.1"), false);
	});
});

describe("util.removeDescendants", () => {
	const isWin = /^win/.test(process.platform);
	const sampleFolderPath = (isWin ? "X:\\" : "/tmp/");
	it("should leave distinct paths intact", () => {
		const input = [
			path.join(sampleFolderPath, "a"),
			path.join(sampleFolderPath, "b"),
			path.join(sampleFolderPath, "c"),
			path.join(sampleFolderPath, "d", "e")
		];
		const expected = input;
		assert.deepEqual(
			util.removeDescendants(input),
			expected
		);
	});

	it("should remove duplicates", () => {
		const input = [
			path.join(sampleFolderPath, "a"),
			path.join(sampleFolderPath, "b"),
			path.join(sampleFolderPath, "c"),
			path.join(sampleFolderPath, "d", "e"),
			path.join(sampleFolderPath, "d", "e"),
			path.join(sampleFolderPath, "b")
		];
		const expected = [
			path.join(sampleFolderPath, "a"),
			path.join(sampleFolderPath, "b"),
			path.join(sampleFolderPath, "c"),
			path.join(sampleFolderPath, "d", "e")
		];
		assert.deepEqual(
			util.removeDescendants(input),
			expected
		);
	});

	it("should remove paths already covered by ancestors", () => {
		const input = [
			path.join(sampleFolderPath, "a"),
			path.join(sampleFolderPath, "b"),
			path.join(sampleFolderPath, "c"),
			path.join(sampleFolderPath, "d", "e"),
			path.join(sampleFolderPath, "d"),
			path.join(sampleFolderPath, "c", "d", "e")
		];
		const expected = [
			path.join(sampleFolderPath, "a"),
			path.join(sampleFolderPath, "b"),
			path.join(sampleFolderPath, "c"),
			path.join(sampleFolderPath, "d")
		];
		assert.deepEqual(
			util.removeDescendants(input),
			expected
		);
	});
});
