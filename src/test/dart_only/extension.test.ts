import * as assert from "assert";
import * as path from "path";
import * as vs from "vscode";
import { isWin } from "../../extension/debug/utils";
import { fsPath, Sdks } from "../../extension/utils";
import { logInfo } from "../../extension/utils/log";
import { activateWithoutAnalysis, ext, extApi } from "../helpers";

const sampleFilePath = (isWin ? "X:\\" : "/tmp/") + "sample.dart";
const sampleFileUri = vs.Uri.parse(`untitled:${sampleFilePath}`);

describe("test environment", () => {
	it("has opened the correct folder", () => {
		const wfs = vs.workspace.workspaceFolders || [];
		assert.equal(wfs.length, 1);
		assert.ok(
			fsPath(wfs[0].uri).endsWith(path.sep + "hello_world"),
			`${fsPath(wfs[0].uri)} doesn't end with ${path.sep}hello_world`,
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
		assert.ok(extApi);
		const sdks: Sdks = extApi.workspaceContext.sdks;
		assert.ok(sdks);
		assert.ok(sdks.dart);
		logInfo("        " + JSON.stringify(sdks, undefined, 8).trim().slice(1, -1).trim());
		logInfo(`        "analysis_server": ${extApi.analyzerCapabilities.version}`);
	});
	it("did not try to use Flutter's version of the Dart SDK", async () => {
		await activateWithoutAnalysis();
		assert.ok(extApi);
		const sdks: Sdks = extApi.workspaceContext.sdks;
		assert.ok(sdks);
		assert.ok(sdks.dart);
		assert.equal(sdks.dartSdkIsFromFlutter, false);
		assert.equal(sdks.dart!.indexOf("flutter"), -1);
	});
});
