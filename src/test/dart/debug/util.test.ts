import * as assert from "assert";
import { isWithinPath } from "../../../shared/utils";
import { fsPath } from "../../../shared/vscode/utils";
import { emptyFile, everythingFile, ext, flutterEmptyFile, flutterHelloWorldFolder, flutterHelloWorldMainFile, helloWorldFolder } from "../../helpers";

describe("isWithinPath", () => {
	it("should return true for children", () => {
		assert.equal(isWithinPath(fsPath(helloWorldFolder), ext.extensionPath), true);
		assert.equal(isWithinPath(fsPath(emptyFile), ext.extensionPath), true);
		assert.equal(isWithinPath(fsPath(everythingFile), ext.extensionPath), true);
		assert.equal(isWithinPath(fsPath(emptyFile), fsPath(helloWorldFolder)), true);
		assert.equal(isWithinPath(fsPath(everythingFile), fsPath(helloWorldFolder)), true);

		assert.equal(isWithinPath(fsPath(flutterHelloWorldFolder), ext.extensionPath), true);
		assert.equal(isWithinPath(fsPath(flutterEmptyFile), ext.extensionPath), true);
		assert.equal(isWithinPath(fsPath(flutterHelloWorldMainFile), ext.extensionPath), true);
		assert.equal(isWithinPath(fsPath(flutterEmptyFile), fsPath(flutterHelloWorldFolder)), true);
		assert.equal(isWithinPath(fsPath(flutterHelloWorldMainFile), fsPath(flutterHelloWorldFolder)), true);
	});

	it("should return false for parents", () => {
		assert.equal(isWithinPath(ext.extensionPath, fsPath(helloWorldFolder)), false);
		assert.equal(isWithinPath(ext.extensionPath, fsPath(emptyFile)), false);
		assert.equal(isWithinPath(ext.extensionPath, fsPath(everythingFile)), false);
		assert.equal(isWithinPath(fsPath(helloWorldFolder), fsPath(emptyFile)), false);
		assert.equal(isWithinPath(fsPath(helloWorldFolder), fsPath(everythingFile)), false);

		assert.equal(isWithinPath(ext.extensionPath, fsPath(flutterHelloWorldFolder)), false);
		assert.equal(isWithinPath(ext.extensionPath, fsPath(flutterEmptyFile)), false);
		assert.equal(isWithinPath(ext.extensionPath, fsPath(flutterHelloWorldMainFile)), false);
		assert.equal(isWithinPath(fsPath(flutterHelloWorldFolder), fsPath(flutterEmptyFile)), false);
		assert.equal(isWithinPath(fsPath(flutterHelloWorldFolder), fsPath(flutterHelloWorldMainFile)), false);
	});

	it("should return false for same input", () => {
		assert.equal(isWithinPath(ext.extensionPath, ext.extensionPath), false);
		assert.equal(isWithinPath(fsPath(helloWorldFolder), fsPath(helloWorldFolder)), false);
		assert.equal(isWithinPath(fsPath(emptyFile), fsPath(emptyFile)), false);
		assert.equal(isWithinPath(fsPath(everythingFile), fsPath(everythingFile)), false);
		assert.equal(isWithinPath(fsPath(flutterHelloWorldFolder), fsPath(flutterHelloWorldFolder)), false);
		assert.equal(isWithinPath(fsPath(flutterEmptyFile), fsPath(flutterEmptyFile)), false);
		assert.equal(isWithinPath(fsPath(flutterHelloWorldMainFile), fsPath(flutterHelloWorldMainFile)), false);
	});
});
