import * as assert from "assert";
import * as vs from "vscode";
import { Sdks } from "../../src/utils";

const isWin = /^win/.test(process.platform);
const ext = vs.extensions.getExtension("Dart-Code.dart-code");

describe("Test environment", () => {
	it("has opened the correct folder", () => {
		const wfs = vs.workspace.workspaceFolders;
		assert.equal(wfs.length, 1);
		assert.ok(
			wfs[0].uri.path.endsWith("flutter_hello_world"),
			wfs[0].uri.path + " doesn't end with flutter_hello_world",
		);
	});
});

describe("Extension", () => {
	it("activated", async () => {
		await ext.activate();
		assert.equal(ext.isActive, true);
	});
	it("found the Dart and Flutter SDK", async () => {
		await ext.activate();
		const sdks: Sdks = ext.exports.sdks;
		assert.ok(sdks.dart);
		assert.ok(sdks.flutter);
	});
});
