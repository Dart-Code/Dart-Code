import * as fs from "fs";
import * as path from "path";
import * as vs from "vscode";
import { fsPath } from "../../../shared/utils/fs";
import { activate, closeAllOpenFiles, defer, delay, enableLint, ensureError, openFile, threeMinutesInMilliseconds, tryDelete, waitForResult, waitUntilAllTextDocumentsAreClosed } from "../../helpers";
import { allowSlowSubscriptionTests } from "../file_tracking.test";

describe("renames", () => {

	beforeEach("activate", () => activate());

	it("fixing lowercase_with_underscores removes diagnostic", async function () {
		this.timeout(threeMinutesInMilliseconds + (1000 * 30));
		if (!allowSlowSubscriptionTests)
			this.skip();

		const projectPath = fsPath(vs.workspace.workspaceFolders![0].uri);
		const filename = "File11111.dart";
		const originalFileUri = vs.Uri.file(path.join(projectPath, filename));
		const fixedFileUri = vs.Uri.file(path.join(projectPath, filename.toLowerCase()));

		fs.writeFileSync(fsPath(originalFileUri), "");
		defer(() => tryDelete(originalFileUri));
		defer(() => tryDelete(fixedFileUri));
		enableLint(projectPath, "file_names");
		await openFile(originalFileUri);

		// Ensure error appears.
		await waitForResult(() => vs.languages.getDiagnostics(originalFileUri).length !== 0, "Error should have appeared");
		const errors = vs.languages.getDiagnostics(originalFileUri);
		ensureError(errors, "Name source files using `lowercase_with_underscores`");

		// Close the file, rename it and reopen.
		await closeAllOpenFiles();
		fs.renameSync(fsPath(originalFileUri), fsPath(fixedFileUri));
		await waitUntilAllTextDocumentsAreClosed();
		await openFile(fixedFileUri);
		await delay(500); // Allow time for the diagnostic to come back (if it will).

		// Ensure error disappears.
		await waitForResult(() => vs.languages.getDiagnostics(originalFileUri).length === 0, "Error should have disappeared");
		await waitForResult(() => vs.languages.getDiagnostics(fixedFileUri).length === 0, "Error should have disappeared");
	});

});
