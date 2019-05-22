import * as assert from "assert";
import * as path from "path";
import * as vs from "vscode";
import { fsPath } from "../../shared/vscode/utils";

describe("test environment", () => {
	it("has opened the correct folder", () => {
		const wfs = vs.workspace.workspaceFolders || [];
		assert.equal(wfs.length, 2);
		assert.ok(
			fsPath(wfs[0].uri).endsWith(path.sep + "flutter_create_basic"),
			`${fsPath(wfs[0].uri)} doesn't end with ${path.sep}flutter_create_basic`,
		);
		assert.ok(
			fsPath(wfs[1].uri).endsWith(path.sep + "flutter_create_sample"),
			`${fsPath(wfs[1].uri)} doesn't end with ${path.sep}flutter_create_sample`,
		);
	});
});
