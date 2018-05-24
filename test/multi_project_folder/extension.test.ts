import * as assert from "assert";
import * as path from "path";
import * as vs from "vscode";
import { fsPath } from "../../src/utils";
import { ext, flutterHelloWorldFolder, flutterHelloWorldMainFile } from "../helpers";

describe("test environment", () => {
	it("has opened the correct folder", () => {
		const wfs = vs.workspace.workspaceFolders;
		assert.equal(wfs.length, 1);
		assert.ok(
			fsPath(wfs[0].uri).endsWith(path.sep + "test_projects"),
			`${fsPath(wfs[0].uri)} doesn't end with ${path.sep}test_projects`,
		);
	});
});

describe("extension", () => {
	it("resolves the correct debug config for a nested project", async () => {
		const resolvedConfig = await ext.exports.debugProvider.resolveDebugConfiguration(
			vs.workspace.workspaceFolders[0],
			{
				name: "Dart",
				program: fsPath(flutterHelloWorldMainFile),
				request: "launch",
				type: "dart",
			},
		);
		assert.equal(resolvedConfig.cwd, fsPath(flutterHelloWorldFolder));
	});
});
