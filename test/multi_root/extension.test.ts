import * as assert from "assert";
import * as path from "path";
import * as vs from "vscode";
import { Sdks, fsPath } from "../../src/utils";
import { ext } from "../helpers";

describe("test environment", () => {
	it("has opened the correct folder", () => {
		const wfs = vs.workspace.workspaceFolders;
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
