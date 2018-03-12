import * as assert from "assert";
import * as path from "path";
import * as sinon from "sinon";
import * as vs from "vscode";
import { delay } from "../../helpers";

const ext = vs.extensions.getExtension("Dart-Code.dart-code");

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
	it("Flutter: New Project can be invoked", async () => {
		const spy = sinon.spy(vs.window, "showInputBox");
		vs.commands.executeCommand("flutter.createProject");
		// Allow time for the box to open - we can't await the command since
		// it's never going to complete. We need to wait long enough to allow for
		// the extension to activate and then run the command.
		await delay(1000);
		assert.ok(spy.called);
		spy.restore();
	});
});
