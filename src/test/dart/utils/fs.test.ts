import { strict as assert } from "assert";
import { Uri } from "vscode";
import { isWin } from "../../../shared/constants";
import { findCommonAncestorFolder, fsPath, uriComparisonString } from "../../../shared/utils/fs";
import { flutterHelloWorldFolder, helloWorldFolder, helloWorldTestFolder, testProjectsFolder } from "../../helpers";

describe("findCommonAncestorFolder", () => {
	it("handles empty array", () => {
		assert.equal(findCommonAncestorFolder([]), undefined);
	});

	it("handles single item array", () => {
		assert.equal(
			findCommonAncestorFolder([
				fsPath(helloWorldFolder),
			]),
			fsPath(helloWorldFolder),
		);
	});

	it("handles multiple folders with shared ancestor", () => {
		assert.equal(
			findCommonAncestorFolder([
				fsPath(helloWorldFolder),
				fsPath(helloWorldTestFolder),
				fsPath(flutterHelloWorldFolder),
			]),
			fsPath(Uri.file(testProjectsFolder)),
		);
	});

	it("returns undefined for paths without a shared ancestor", () => {
		assert.equal(
			findCommonAncestorFolder([
				fsPath(helloWorldFolder),
				fsPath(helloWorldTestFolder),
				fsPath(flutterHelloWorldFolder),
				isWin ? "Z:\\foo\\bar" : "/foo/bar",
			]),
			undefined,
		);
	});
});

describe("uriComparisonString", () => {
	it("handles differences in drive letter casing for file scheme", function () {
		if (!isWin)
			this.skip();

		// Upper -> upper
		assert.equal(
			uriComparisonString(Uri.file("C:\\test\\test")),
			"file:C:\\test\\test",
		);
		// Lower -> upper
		assert.equal(
			uriComparisonString(Uri.file("c:\\test\\test")),
			"file:C:\\test\\test",
		);
	});

	it("handles differences in drive letter casing for dart-macro+file scheme", function () {
		if (!isWin)
			this.skip();

		// Upper -> upper
		assert.equal(
			uriComparisonString(Uri.file("C:\\test\\test").with({ scheme: "dart-macro+file" })),
			"dart-macro+file:C:\\test\\test",
		);
		// Lower -> upper
		assert.equal(
			uriComparisonString(Uri.file("c:\\test\\test").with({ scheme: "dart-macro+file" })),
			"dart-macro+file:C:\\test\\test",
		);
	});

	it("handles URIs", function () {
		if (!isWin)
			this.skip();

		assert.equal(
			uriComparisonString(Uri.parse("http://foo/bar")),
			"http://foo/bar",
		);
	});
});
