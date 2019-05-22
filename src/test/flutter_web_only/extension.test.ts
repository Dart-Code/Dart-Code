import * as assert from "assert";
import * as path from "path";
import * as vs from "vscode";
import { logInfo } from "../../extension/utils/log";
import { activateWithoutAnalysis, ext, extApi } from "../helpers";
import { fsPath } from "../../shared/vscode/utils";
import { Sdks } from "../../shared/interfaces";

describe("test environment", () => {
	it("has opened the correct folder", () => {
		const wfs = vs.workspace.workspaceFolders || [];
		assert.equal(wfs.length, 1);
		assert.ok(
			fsPath(wfs[0].uri).endsWith(`${path.sep}flutter_web`),
			`${fsPath(wfs[0].uri)} doesn't end with ${path.sep}flutter_web`,
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
		const sdks: Sdks = extApi.workspaceContext.sdks;
		assert.ok(sdks);
		assert.ok(sdks.dart);
		assert.ok(sdks.flutter);
		logInfo("        " + JSON.stringify(sdks, undefined, 8).trim().slice(1, -1).trim());
		logInfo(`        "analysis_server": ${extApi.analyzerCapabilities.version}`);
	});
	it("used Flutter's version of the Dart SDK", async () => {
		await activateWithoutAnalysis();
		assert.ok(extApi);
		const sdks: Sdks = extApi.workspaceContext.sdks;
		assert.ok(sdks);
		assert.ok(sdks.dart);
		assert.equal(sdks.dartSdkIsFromFlutter, true);
		assert.notEqual(sdks.dart!.indexOf("flutter"), -1);
	});
});
