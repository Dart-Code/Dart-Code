import * as assert from "assert";
import * as util from "../../../extension/debug/utils";
import { fsPath } from "../../../extension/utils";
import { emptyFile, everythingFile, ext, flutterEmptyFile, flutterHelloWorldFolder, flutterHelloWorldMainFile, helloWorldFolder } from "../../helpers";

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

describe("util.isWithinPath", () => {
	it("should return true for children", () => {
		assert.equal(util.isWithinPath(fsPath(helloWorldFolder), ext.extensionPath), true);
		assert.equal(util.isWithinPath(fsPath(emptyFile), ext.extensionPath), true);
		assert.equal(util.isWithinPath(fsPath(everythingFile), ext.extensionPath), true);
		assert.equal(util.isWithinPath(fsPath(emptyFile), fsPath(helloWorldFolder)), true);
		assert.equal(util.isWithinPath(fsPath(everythingFile), fsPath(helloWorldFolder)), true);

		assert.equal(util.isWithinPath(fsPath(flutterHelloWorldFolder), ext.extensionPath), true);
		assert.equal(util.isWithinPath(fsPath(flutterEmptyFile), ext.extensionPath), true);
		assert.equal(util.isWithinPath(fsPath(flutterHelloWorldMainFile), ext.extensionPath), true);
		assert.equal(util.isWithinPath(fsPath(flutterEmptyFile), fsPath(flutterHelloWorldFolder)), true);
		assert.equal(util.isWithinPath(fsPath(flutterHelloWorldMainFile), fsPath(flutterHelloWorldFolder)), true);
	});

	it("should return false for parents", () => {
		assert.equal(util.isWithinPath(ext.extensionPath, fsPath(helloWorldFolder)), false);
		assert.equal(util.isWithinPath(ext.extensionPath, fsPath(emptyFile)), false);
		assert.equal(util.isWithinPath(ext.extensionPath, fsPath(everythingFile)), false);
		assert.equal(util.isWithinPath(fsPath(helloWorldFolder), fsPath(emptyFile)), false);
		assert.equal(util.isWithinPath(fsPath(helloWorldFolder), fsPath(everythingFile)), false);

		assert.equal(util.isWithinPath(ext.extensionPath, fsPath(flutterHelloWorldFolder)), false);
		assert.equal(util.isWithinPath(ext.extensionPath, fsPath(flutterEmptyFile)), false);
		assert.equal(util.isWithinPath(ext.extensionPath, fsPath(flutterHelloWorldMainFile)), false);
		assert.equal(util.isWithinPath(fsPath(flutterHelloWorldFolder), fsPath(flutterEmptyFile)), false);
		assert.equal(util.isWithinPath(fsPath(flutterHelloWorldFolder), fsPath(flutterHelloWorldMainFile)), false);
	});

	it("should return false for same input", () => {
		assert.equal(util.isWithinPath(ext.extensionPath, ext.extensionPath), false);
		assert.equal(util.isWithinPath(fsPath(helloWorldFolder), fsPath(helloWorldFolder)), false);
		assert.equal(util.isWithinPath(fsPath(emptyFile), fsPath(emptyFile)), false);
		assert.equal(util.isWithinPath(fsPath(everythingFile), fsPath(everythingFile)), false);
		assert.equal(util.isWithinPath(fsPath(flutterHelloWorldFolder), fsPath(flutterHelloWorldFolder)), false);
		assert.equal(util.isWithinPath(fsPath(flutterEmptyFile), fsPath(flutterEmptyFile)), false);
		assert.equal(util.isWithinPath(fsPath(flutterHelloWorldMainFile), fsPath(flutterHelloWorldMainFile)), false);
	});
});
