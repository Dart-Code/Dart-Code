import { strict as assert } from "assert";

import { fsPath } from "../../../shared/utils/fs";
import { getPackageOrFolderDisplayName } from "../../../shared/vscode/display_names";
import { flutterHelloWorldExampleFolder, flutterHelloWorldFolder, helloWorldExampleSubFolder, helloWorldFolder } from "../../helpers";

describe("getPackageOrFolderDisplayName", () => {
	it("for workspace folder package", () => {
		assert.equal(getPackageOrFolderDisplayName(fsPath(helloWorldFolder)), "package:hello_world");
	});
	it("for nested example folder", () => {
		assert.equal(getPackageOrFolderDisplayName(fsPath(helloWorldExampleSubFolder)), "package:hello_world_example (example)");
	});
	it("for external folder package", () => {
		assert.equal(getPackageOrFolderDisplayName(fsPath(flutterHelloWorldFolder)), "package:flutter_hello_world");
	});
	it("for nested external folder package", () => {
		assert.equal(getPackageOrFolderDisplayName(fsPath(flutterHelloWorldExampleFolder)), "package:flutter_hello_world_example (example)");
	});
});
