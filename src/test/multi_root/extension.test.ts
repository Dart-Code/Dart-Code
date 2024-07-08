import { strict as assert } from "assert";
import * as path from "path";
import * as vs from "vscode";
import { Sdks } from "../../shared/interfaces";
import { fsPath } from "../../shared/utils/fs";
import { activateWithoutAnalysis, ext, extApi, flutterHelloWorldFolder, helloWorldFolder, helloWorldMainFile } from "../helpers";

describe("test environment", () => {
	it("has opened the correct folder", () => {
		const wfs = vs.workspace.workspaceFolders || [];
		assert.equal(wfs.length, 2);
		assert.ok(
			fsPath(wfs[0].uri).endsWith(path.sep + "flutter_hello_world"),
			`${fsPath(wfs[0].uri)} doesn't end with ${path.sep}flutter_hello_world`,
		);
		assert.ok(
			fsPath(wfs[1].uri).endsWith(path.sep + "hello_world"),
			`${fsPath(wfs[1].uri)} doesn't end with ${path.sep}hello_world`,
		);
	});
});

describe("extension", () => {
	it("activated", async () => {
		await activateWithoutAnalysis();
		assert.equal(ext.isActive, true);
	});
	it("found the Dart and Flutter SDK", async () => {
		await activateWithoutAnalysis();
		assert.ok(extApi);
		// TODO: Add tests for the workspaceContext flags (here and elsewhere).
		const sdks: Sdks = extApi.workspaceContext.sdks;
		assert.ok(sdks);
		assert.ok(sdks.dart);
		assert.ok(sdks.flutter);
	});
	it("used Flutter's version of the Dart SDK", async () => {
		await activateWithoutAnalysis();
		assert.ok(extApi);
		const sdks: Sdks = extApi.workspaceContext.sdks;
		assert.ok(sdks);
		assert.ok(sdks.dart);
		assert.notEqual(sdks.dart.toLowerCase().indexOf("flutter"), -1);
	});
	it("resolves the correct debug config for a nested project", async () => {
		await activateWithoutAnalysis();
		const resolvedConfig = await extApi.debugProvider.resolveDebugConfigurationWithSubstitutedVariables!(
			vs.workspace.workspaceFolders![1],
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
		assert.deepStrictEqual(resolvedConfig.additionalProjectPaths, [fsPath(flutterHelloWorldFolder), fsPath(helloWorldFolder)]);
	});
});
