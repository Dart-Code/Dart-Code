import * as assert from "assert";
import * as path from "path";
import * as sinon from "sinon";
import * as vs from "vscode";
import { Sdks } from "../../src/utils";
import { checkForProjectsInSubFolders, UPGRADE_TO_WORKSPACE_FOLDERS } from "../../src/project";
import { waitFor, sb } from "../helpers";

const isWin = /^win/.test(process.platform);

describe("test environment", () => {
	it("has opened the correct folder", () => {
		const wfs = vs.workspace.workspaceFolders;
		assert.equal(wfs.length, 1);
		assert.ok(
			wfs[0].uri.fsPath.endsWith(path.sep + "test_projects"),
			`${wfs[0].uri.fsPath} doesn't end with ${path.sep}test_projects`,
		);
	});
});

describe("extension", () => {
	it("prompted the user to upgrade project folders", async () => {
		// Intercept executeCommand for openFolder so we don't spawn a new instance of Code!
		const showWarningMessage = sb.stub(vs.window, "showWarningMessage");
		const upgradeMessage = showWarningMessage.withArgs(sinon.match.any, UPGRADE_TO_WORKSPACE_FOLDERS, sinon.match.any).resolves();
		showWarningMessage.callThrough();

		// Force a call to detect them.
		checkForProjectsInSubFolders();

		// Wait up to a second for the message to be called.
		await waitFor(() => upgradeMessage.calledOnce);

		showWarningMessage.restore();
	});
});
