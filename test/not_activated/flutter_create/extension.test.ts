import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import * as sinon from "sinon";
import * as vs from "vscode";
import { delay, getRandomTempFolder, waitFor, ext } from "../../helpers";
import { FLUTTER_CREATE_PROJECT_TRIGGER_FILE } from "../../../src/utils";

describe("Test environment", () => {
	it("has opened the correct folder", () => {
		const wfs = vs.workspace.workspaceFolders;
		assert.equal(wfs.length, 1);
		assert.ok(
			wfs[0].uri.fsPath.endsWith(path.sep + "empty"),
			`${wfs[0].uri.fsPath} doesn't end with ${path.sep}empty`,
		);
	});
});

describe("Extension", () => {
	it("did not activate", async () => {
		assert.equal(ext.isActive, false);
	});
});

// Note: We can only really have one "real" test here because it'll activate the extension.
// Other tests must go in their own folders and be listed in test_all/launch.json individually.

describe("Command", () => {
	it("Flutter: New Project can be invoked and creates trigger file", async () => {
		const showInputBox = sinon.stub(vs.window, "showInputBox");
		showInputBox.resolves("my_test_flutter_proj");

		const showOpenDialog = sinon.stub(vs.window, "showOpenDialog");
		const tempFolder = getRandomTempFolder();
		showOpenDialog.resolves([vs.Uri.file(tempFolder)]);

		// Intercept executeCommand for openFolder so we don't spawn a new instance of Code!
		const executeCommand = sinon.stub(vs.commands, "executeCommand");
		const openFolder = executeCommand.withArgs("vscode.openFolder", sinon.match.any).resolves(null);
		executeCommand.callThrough();

		await vs.commands.executeCommand("flutter.createProject");

		assert.ok(showInputBox.calledOnce);
		assert.ok(showOpenDialog.calledOnce);
		assert.ok(openFolder.calledOnce);
		assert.ok(fs.existsSync(path.join(tempFolder, "my_test_flutter_proj", FLUTTER_CREATE_PROJECT_TRIGGER_FILE)));

		showInputBox.restore();
		showOpenDialog.restore();
		executeCommand.restore();
	});
});
