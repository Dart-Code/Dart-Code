import * as assert from "assert";
import * as path from "path";
import * as vs from "vscode";
import { isWin } from "../../src/debug/utils";
import { Sdks, fsPath } from "../../src/utils";
import { logInfo } from "../../src/utils/log";
import { ext } from "../helpers";

const sampleFilePath = (isWin ? "X:\\" : "/tmp/") + "sample.dart";
const sampleFileUri = vs.Uri.parse(`untitled:${sampleFilePath}`);

describe("test environment", () => {
	it("has opened the correct folder", () => {
		const wfs = vs.workspace.workspaceFolders;
		assert.equal(wfs.length, 1);
		assert.ok(
			fsPath(wfs[0].uri).endsWith(path.sep + "hello_world"),
			`${fsPath(wfs[0].uri)} doesn't end with ${path.sep}hello_world`,
		);
	});
});

describe("extension", () => {
	it("activated", async () => {
		await ext.activate();
		assert.equal(ext.isActive, true);
	});
	it("found the Dart SDK", async () => {
		await ext.activate();
		assert.ok(ext.exports);
		const sdks: Sdks = ext.exports.sdks;
		assert.ok(sdks);
		assert.ok(sdks.dart);
		logInfo("        " + JSON.stringify(sdks, undefined, 8).trim().slice(1, -1).trim());
		logInfo(`        "analysis_server": ${ext.exports.analyzerCapabilities.version}`);
	});
	it("did not try to use Flutter's version of the Dart SDK", async () => {
		await ext.activate();
		assert.ok(ext.exports);
		const sdks: Sdks = ext.exports.sdks;
		assert.ok(sdks);
		assert.equal(sdks.dart.indexOf("flutter"), -1);
	});
});
