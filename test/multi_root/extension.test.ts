import * as assert from "assert";
import * as path from "path";
import * as vs from "vscode";
import { Sdks } from "../../src/utils";
import { ext } from "../helpers";

const isWin = /^win/.test(process.platform);

describe("test environment", () => {
	it("has opened the correct folder", () => {
		const wfs = vs.workspace.workspaceFolders;
		assert.equal(wfs.length, 2);
		assert.ok(
			wfs[0].uri.fsPath.endsWith(path.sep + "flutter_hello_world"),
			`${wfs[0].uri.fsPath} doesn't end with ${path.sep}flutter_hello_world`,
		);
		assert.ok(
			wfs[1].uri.fsPath.endsWith(path.sep + "hello_world"),
			`${wfs[1].uri.fsPath} doesn't end with ${path.sep}hello_world`,
		);
	});
});

describe("extension", () => {
	it("activated", async () => {
		await ext.activate();
		assert.equal(ext.isActive, true);
	});
	it("found the Dart and Flutter SDK", async () => {
		await ext.activate();
		assert.ok(ext.exports);
		const sdks: Sdks = ext.exports.sdks;
		assert.ok(sdks);
		assert.ok(sdks.dart);
		assert.ok(sdks.flutter);
	});
	it("used Flutter's version of the Dart SDK", async () => {
		await ext.activate();
		assert.ok(ext.exports);
		const sdks: Sdks = ext.exports.sdks;
		assert.ok(sdks);
		assert.notEqual(sdks.dart.indexOf("flutter"), -1);
	});
});
