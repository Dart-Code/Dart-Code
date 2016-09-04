import * as assert from 'assert';
import * as vs from "vscode";
import * as extension from "../src/extension";

const isWin = /^win/.test(process.platform);
const ext = vs.extensions.getExtension/*<extension.ExtensionApi>*/("DanTup.dart-code");
const sampleFilePath = (isWin ? "X:\\" : "/tmp/") + "sample.dart";
const sampleFileUri = vs.Uri.parse(`untitled:${sampleFilePath}`);

describe("Extension", () => {
    it("is not activated initially", () => {
		assert.equal(ext.isActive, false);
    });
	it("is activated successfully upon opening a Dart file", done => {
		vs.workspace.openTextDocument(sampleFileUri)
			.then(() => assert.equal(ext.isActive, true))
			.then(() => assert.notEqual(extension.dartSdkRoot, null))
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
