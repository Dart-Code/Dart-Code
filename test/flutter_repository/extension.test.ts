import * as assert from "assert";
import * as path from "path";
import * as vs from "vscode";
import { fsPath } from "../../src/utils";
import { activateWithoutAnalysis, ext, extApi, getPackages } from "../helpers";

beforeEach("set timeout", function () {
	this.timeout(90000); // These tests can be slow due to having to analyzer the whole Flutter repo.
});

describe("test environment", () => {
	it("has opened the correct folder", () => {
		const wfs = vs.workspace.workspaceFolders;
		assert.equal(wfs.length, 1);
		assert.ok(
			fsPath(wfs[0].uri).endsWith(path.sep + "flutter"),
			`${fsPath(wfs[0].uri)} doesn't end with ${path.sep}flutter`,
		);
	});
});

describe("extension", () => {
	it("activated", async () => {
		await activateWithoutAnalysis();
		assert.equal(ext.isActive, true);
	});
	it("reported no errors when analysis completed", async () => {
		await activateWithoutAnalysis();
		await extApi.initialAnalysis;
		await getPackages();

		function warningOrError(d: vs.Diagnostic) {
			return d.severity <= vs.DiagnosticSeverity.Warning;
		}

		const filesWithErrors = vs.languages
			.getDiagnostics()
			.filter((file) => file[1].find(warningOrError));
		if (filesWithErrors.length !== 0) {
			assert.equal(
				filesWithErrors.length,
				0,
				`Expected no errors, but got some:\n`
				+ filesWithErrors
					.slice(0, Math.min(10, filesWithErrors.length))
					.map((file) => {
						return "    "
							+ path.basename(fsPath(file[0]))
							+ ": "
							+ file[1].find(warningOrError).message;
					})
					.join("\n"),
			);
		}
	}).timeout(1000 * 60 * 5); // 5 minutes
});
