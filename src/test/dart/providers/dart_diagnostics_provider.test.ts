import * as assert from "assert";
import * as vs from "vscode";
import { activate, delay, emptyFile, emptyFileInExcludedFolder, ensureError, openFile, setTestContent, waitForDiagnosticChange } from "../../helpers";

describe("diagnostics_provider", () => {

	beforeEach("activate emptyFile", () => activate(emptyFile));

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
		// Set up a handler for when the diagnostics change.
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

	it("does not return errors for an excluded file", async () => {
		await openFile(emptyFileInExcludedFolder);
		await setTestContent(`
main() {
  print("Hello, world!);
}
		`);

		// Wait for 5 seconds and ensure we don't have any errors. We can't wait on a change
		// to diagnostics because if things are working correctly we won't be getting any.
		await delay(5000);

		const errors = vs.languages.getDiagnostics(emptyFileInExcludedFolder);
		assert.equal(0, errors.length);
	});
});
