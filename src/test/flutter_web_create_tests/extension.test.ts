import * as assert from "assert";
import * as path from "path";
import * as vs from "vscode";
import { fsPath } from "../../extension/utils";

describe("test environment", () => {
	it("has opened the correct folder", () => {
		const wfs = vs.workspace.workspaceFolders || [];
		assert.equal(wfs.length, 1);
		assert.ok(
			fsPath(wfs[0].uri).endsWith(path.sep + "flutter_web_create"),
			`${fsPath(wfs[0].uri)} doesn't end with ${path.sep}flutter_web_create`,
		);
	});
});
