import { strict as assert } from "assert";
import * as path from "path";
import * as vs from "vscode";
import { fsPath } from "../../shared/utils/fs";
import { activate, helloWorldFolder, helloWorldMainFile, privateApi } from "../helpers";

describe("test environment", () => {
	it("has opened the correct folder", () => {
		const wfs = vs.workspace.workspaceFolders || [];
		assert.equal(wfs.length, 1);
		assert.ok(
			fsPath(wfs[0].uri).endsWith(path.sep + "test_projects"),
			`${fsPath(wfs[0].uri)} doesn't end with ${path.sep}test_projects`,
		);
	});
});

describe("extension", () => {
	it("resolves the correct debug config for a nested project", async () => {
		await activate();
		const resolvedConfig = await privateApi.debugProvider.resolveDebugConfigurationWithSubstitutedVariables!(
			vs.workspace.workspaceFolders![0],
			{
				name: "Dart",
				program: fsPath(helloWorldMainFile),
				request: "launch",
				suppressPrompts: true,
				type: "dart",
			},
		);

		assert.ok(resolvedConfig);
		assert.equal(resolvedConfig.cwd, fsPath(helloWorldFolder));
	});
});
