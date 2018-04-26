import * as assert from "assert";
import * as path from "path";
import * as vs from "vscode";
import { Sdks, fsPath } from "../../src/utils";
import { ext } from "../helpers";

const isWin = /^win/.test(process.platform);

describe("Test environment", () => {
	it("has opened the correct folder", () => {
		const wfs = vs.workspace.workspaceFolders;
		assert.equal(wfs.length, 1);
		assert.ok(
			fsPath(wfs[0].uri).endsWith(path.sep + "flutter"),
			`${fsPath(wfs[0].uri)} doesn't end with ${path.sep}flutter`,
		);
	});
});

describe("Extension", () => {
	it("activated", async () => {
		await ext.activate();
		assert.equal(ext.isActive, true);
	});
	it("Reported no errors", async () => {
		await ext.activate();
		await ext.exports.initialAnalysis;

		// Fetch packages and wait for the next analysis to complete.
		const analysisComplete = ext.exports.nextAnalysis();
		await vs.commands.executeCommand("flutter.packages.get", vs.workspace.workspaceFolders[0].uri);
		await analysisComplete;

		const filesWithErrors = vs.languages
			.getDiagnostics()
			.filter((file) => file[1].length);
		if (filesWithErrors.length !== 0) {
			assert.equal(
				filesWithErrors.length,
				0,
				`Expected no errors, but got some:\n`
				+ filesWithErrors
					.slice(0, Math.min(10, filesWithErrors.length))
					.map((file) => `    ${path.basename(fsPath(file[0]))}: ${file[1][0].message}`)
					.join("\n"),
			);
		}
	}).timeout(1000 * 60 * 5); // 5 minutes
});
