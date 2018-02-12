import * as assert from "assert";
import * as util from "../src/debug/utils";

describe("util.uriToFilePath", () => {
	it("should handle all path formats for Windows", () => {
		assert.equal(util.uriToFilePath("file:///c:/folder/file.dart", true), "c:\\folder\\file.dart");
		assert.equal(util.uriToFilePath("file://c:/folder/file.dart", true), "c:\\folder\\file.dart");
		assert.equal(util.uriToFilePath("/c:/folder/file.dart", true), "c:\\folder\\file.dart");
		assert.equal(util.uriToFilePath("c:/folder/file.dart", true), "c:\\folder\\file.dart");
	});
	it("should handle all path formats for Mac/Linux", () => {
		assert.equal(util.uriToFilePath("file:///folder/file.dart", false), "/folder/file.dart");
		assert.equal(util.uriToFilePath("file://folder/file.dart", false), "/folder/file.dart");
		assert.equal(util.uriToFilePath("/folder/file.dart", false), "/folder/file.dart");
	});
});
