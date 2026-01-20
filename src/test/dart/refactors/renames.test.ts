import * as fs from "fs";
import * as path from "path";
import * as vs from "vscode";
import { fsPath } from "../../../shared/utils/fs";
import { activate, closeAllOpenFiles, defer, delay, enableLint, ensureError, forceDocumentCloseEvents, openFile, tryDelete, waitForResult } from "../../helpers";

// TODO(dantup): Determine why server isn't clearing this even when we renamed and re-opened with fixed casing.
describe.skip("renames", () => {

	beforeEach("activate", () => activate());

	it("fixing lowercase_with_underscores removes diagnostic", async () => {
		const projectPath = fsPath(vs.workspace.workspaceFolders![0].uri);
		const filename = "File11111.dart";
		const originalFileUri = vs.Uri.file(path.join(projectPath, filename));
		const fixedFileUri = vs.Uri.file(path.join(projectPath, filename.toLowerCase()));

		fs.writeFileSync(fsPath(originalFileUri), "");
		defer("Delete diagnostic test file 1", () => tryDelete(originalFileUri));
		defer("Delete diagnostic test file 2", () => tryDelete(fixedFileUri));
		enableLint(projectPath, "file_names");
		await openFile(originalFileUri);

		// Ensure error appears.
		await waitForResult(() => vs.languages.getDiagnostics(originalFileUri).length !== 0, "Error should have appeared");
		const errors = vs.languages.getDiagnostics(originalFileUri);
		ensureError(errors, "isn't a lower_case_with_underscores identifier");

		// Close the file, rename it and reopen.
		await closeAllOpenFiles();
		await forceDocumentCloseEvents();

		fs.renameSync(fsPath(originalFileUri), fsPath(fixedFileUri));

		await openFile(fixedFileUri);
		await delay(500); // Allow time for the diagnostic to come back (if it will).

		// Ensure error disappears.
		await waitForResult(() => vs.languages.getDiagnostics(originalFileUri).length === 0, "Error should have disappeared");
		await waitForResult(() => vs.languages.getDiagnostics(fixedFileUri).length === 0, "Error should have disappeared");
	});
});
