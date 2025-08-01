import { strict as assert } from "assert";
import * as path from "path";
import * as vs from "vscode";
import { Sdks } from "../../shared/interfaces";
import { fsPath } from "../../shared/utils/fs";
import { activateWithoutAnalysis, ext, logger, privateApi } from "../helpers";


describe("test environment", () => {
	it("has opened the correct folder", () => {
		const wfs = vs.workspace.workspaceFolders || [];
		assert.equal(wfs.length, 1);
		assert.ok(
			fsPath(wfs[0].uri).endsWith(path.sep + "dart_nested"),
			`${fsPath(wfs[0].uri)} doesn't end with ${path.sep}dart_nested`,
		);
	});
});

describe("extension", () => {
	it("activated", async () => {
		await activateWithoutAnalysis();
		assert.equal(ext.isActive, true);
	});
	it("found the Dart SDK", async () => {
		await activateWithoutAnalysis();
		assert.ok(privateApi);
		const sdks: Sdks = privateApi.workspaceContext.sdks;
		assert.ok(sdks);
		assert.ok(sdks.dart);
		logger.info("        " + JSON.stringify(sdks, undefined, 8).trim().slice(1, -1).trim());
	});
	it("did not try to use Flutter's version of the Dart SDK", async () => {
		await activateWithoutAnalysis();
		assert.ok(privateApi);
		const sdks: Sdks = privateApi.workspaceContext.sdks;
		assert.ok(sdks);
		assert.ok(sdks.dart);
		assert.equal(sdks.dartSdkIsFromFlutter, false);
		assert.equal(sdks.dart.toLowerCase().indexOf("flutter"), -1);
	});
});
