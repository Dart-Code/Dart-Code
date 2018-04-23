import * as assert from "assert";
import * as path from "path";
import * as fs from "fs";
import * as vs from "vscode";
import { activate, emptyFile, setTestContent, ensureError, delay, waitForDiagnosticChange } from "../../helpers";

describe("diagnostics_provider", () => {

	before(() => activate(emptyFile));

	it("returns no errors for a valid file", async () => {
		await setTestContent(`
main() {
  print("Hello, world!");
}
		`);

		const errors = vs.languages.getDiagnostics(emptyFile);
		assert.equal(0, errors.length);
	});

	it("returns errors for an invalid file", async () => {
		// Set up a handler for when the diagnostics change.)
		const diagnosticChange = waitForDiagnosticChange(emptyFile);

		await setTestContent(`
main() {
  print("Hello, world!);
}
		`);

		// Wait for the diagnostics to change (set up above).
		await diagnosticChange;

		const errors = vs.languages.getDiagnostics(emptyFile);
		ensureError(errors, "Unterminated string literal");
	});
});
