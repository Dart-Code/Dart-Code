import { strict as assert } from "assert";
import * as path from "path";
import * as vs from "vscode";
import { Sdks } from "../../shared/interfaces";
import { fsPath } from "../../shared/utils/fs";
import { activateWithoutAnalysis, ext, extApi, logger, privateApi } from "../helpers";

describe("test environment", () => {
	it("has opened the correct folder", () => {
		const wfs = vs.workspace.workspaceFolders || [];
		assert.equal(wfs.length, 1);
		assert.ok(
			fsPath(wfs[0].uri).endsWith(path.sep + "flutter_hello_world"),
			`${fsPath(wfs[0].uri)} doesn't end with ${path.sep}flutter_hello_world`,
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
		assert.ok(privateApi);
		const sdks: Sdks = privateApi.workspaceContext.sdks;
		assert.ok(sdks);
		assert.ok(sdks.dart);
		assert.ok(sdks.dartVersion);
		assert.ok(sdks.flutter);
		assert.ok(sdks.flutterVersion);
		logger.info("        " + JSON.stringify(sdks, undefined, 8).trim().slice(1, -1).trim());
		assert.equal(extApi.sdks.dart, sdks.dart);
		assert.equal(extApi.sdks.dartVersion, sdks.dartVersion);
		assert.equal(extApi.sdks.flutter, sdks.flutter);
		assert.equal(extApi.sdks.flutterVersion, sdks.flutterVersion);
	});
	it("used Flutter's version of the Dart SDK", async () => {
		await activateWithoutAnalysis();
		assert.ok(privateApi);
		const sdks: Sdks = privateApi.workspaceContext.sdks;
		assert.ok(sdks);
		assert.ok(sdks.dart);
		assert.equal(sdks.dartSdkIsFromFlutter, true);
		assert.notEqual(sdks.dart.toLowerCase().indexOf("flutter"), -1);
	});
	it("set FLUTTER_ROOT", async () => {
		await activateWithoutAnalysis();
		const toolEnv = privateApi.getToolEnv();
		assert.ok(toolEnv?.FLUTTER_ROOT);
		assert.ok(toolEnv?.FLUTTER_ROOT, privateApi.workspaceContext.sdks.flutter);
	});
});
