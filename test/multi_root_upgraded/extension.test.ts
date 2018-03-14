import * as assert from "assert";
import * as path from "path";
import * as sinon from "sinon";
import * as vs from "vscode";
import { Sdks } from "../../src/utils";
import { checkForProjectsInSubFolders } from "../../src/project";
import { waitFor } from "../helpers";

const isWin = /^win/.test(process.platform);
const ext = vs.extensions.getExtension("Dart-Code.dart-code");

describe("Test environment", () => {
	it("has opened the correct folder", () => {
		const wfs = vs.workspace.workspaceFolders;
		assert.equal(wfs.length, 1);
		assert.ok(
			wfs[0].uri.fsPath.endsWith(path.sep + "test_projects"),
			`${wfs[0].uri.fsPath} doesn't end with ${path.sep}test_projects`,
		);
	});
});

describe("Extension", () => {
	it("prompted the user to upgrade project folders", async () => {
		// Intercept executeCommand for openFolder so we don't spawn a new instance of Code!
		const showWarningMessage = sinon.stub(vs.window, "showWarningMessage");
		const updateWorkspaceAction = "Mark Projects as Workspace Folders";
		const upgradeMessage = showWarningMessage.withArgs(sinon.match.any, updateWorkspaceAction, sinon.match.any);

		// Force a call to detect them.
		checkForProjectsInSubFolders();

		// Wait up to a second for the message to be called.
		await waitFor(() => upgradeMessage.calledOnce, 1000);

		showWarningMessage.restore();
	});
});
