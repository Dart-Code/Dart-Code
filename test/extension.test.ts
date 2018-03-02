import * as assert from "assert";
import * as vs from "vscode";
import * as extension from "../src/extension";

const isWin = /^win/.test(process.platform);
const ext = vs.extensions.getExtension("Dart-Code.dart-code");
const sampleFilePath = (isWin ? "X:\\" : "/tmp/") + "sample.dart";
const sampleFileUri = vs.Uri.parse(`untitled:${sampleFilePath}`);

describe("Test environment", () => {
	it("has opened the correct folder", () => {
		const wfs = vs.workspace.workspaceFolders;
		assert.equal(wfs.length, 1);
		assert.ok(
			wfs[0].uri.path.endsWith("hello_world"),
			wfs[0].uri.path + " doesn't end with hello_world",
		);
	});
});

/*
TODO: In Code 1.14 it seems openTextDocument is returning before the extension is activate?
describe("Extension", () => {
	it("is not activated initially", () => {
		assert.equal(ext.isActive, false);
	});
	it("is activated successfully upon opening a Dart file", done => {
		vs.workspace.openTextDocument(sampleFileUri)
			.then(() => assert.equal(ext.isActive, true))
			.then(() => assert.notEqual(extension.sdks.dart, null))
			.then(() => assert.notEqual(extension.analyzer, null))
			.then(() => done(), e => done(new Error(e)));
	});
});

describe("Activated extension", () => {
	before(done => {
		vs.workspace.openTextDocument(sampleFileUri)
			.then(() => done(), e => done(new Error(e)));
	});
	it("has a functional analysis server", done => {
		extension.analyzer.serverGetVersion()
			.then(resp => assert.equal(/^\d+\.\d+\.\d+$/.test(resp.version), true))
			.then(() => done(), e => done(new Error(e)));
	});
});
*/
