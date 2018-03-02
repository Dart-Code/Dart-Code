import * as assert from "assert";
import * as vs from "vscode";

describe("Test environment", () => {
	it("has opened the correct folder", () => {
		const wfs = vs.workspace.workspaceFolders;
		assert.equal(wfs.length, 1);
		assert.ok(
			wfs[0].uri.path.endsWith("flutter_hello_world"),
			wfs[0].uri.path + " doesn't end with flutter_hello_world",
		);
	});
});
