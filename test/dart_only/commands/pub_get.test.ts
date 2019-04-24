import * as assert from "assert";
import * as sinon from "sinon";
import * as vs from "vscode";
import { activate, delay, helloWorldPubspec, openFile, sb, setConfigForTest, setTestContent, waitForResult } from "../../helpers";

describe("pub get", () => {

	beforeEach("activate", () => activate());

	it("runs automatically when pubspec is saved", async () => {
		const executeCommand = sb.stub(vs.commands, "executeCommand").callThrough();
		const getPackagesCommand = executeCommand.withArgs("dart.getPackages", sinon.match.any).resolves();

		const editor = await openFile(helloWorldPubspec);
		const doc = editor.document;
		await setTestContent(doc.getText() + " ");
		await doc.save();

		// Allow a short time for the command to be called because this is now a
		// file system watcher.
		await waitForResult(() => getPackagesCommand.calledOnce);
	});

	it("does not run automatically if disabled", async () => {
		await setConfigForTest("dart", "runPubGetOnPubspecChanges", false);

		const executeCommand = sb.stub(vs.commands, "executeCommand").callThrough();
		const getPackagesCommand = executeCommand.withArgs("dart.getPackages", sinon.match.any).resolves();

		const editor = await openFile(helloWorldPubspec);
		const doc = editor.document;
		await setTestContent(doc.getText() + " ");
		await doc.save();

		// Wait for 2s then ensure it still hadn't run.
		await delay(2000);
		assert.ok(!getPackagesCommand.calledOnce);
	});

	it("runs delayed when pubspec is auto-saved", async () => {
		await setConfigForTest("files", "autoSave", "afterDelay");

		const executeCommand = sb.stub(vs.commands, "executeCommand").callThrough();
		const getPackagesCommand = executeCommand.withArgs("dart.getPackages", sinon.match.any).resolves();

		const editor = await openFile(helloWorldPubspec);
		const doc = editor.document;
		await setTestContent(doc.getText() + " ");

		// Wait for 1sec and ensure it wasn't called.
		await delay(1000);
		assert.ok(!getPackagesCommand.called);

		// Wait for 7sec and make another change to test debouncing.
		await delay(7000);
		await setTestContent(doc.getText() + " ");

		// Wait for 5sec and ensure it still wasn't called (because it was pushed back to 10sec again).
		await delay(5000);
		assert.ok(!getPackagesCommand.called);

		// Wait enough time that it definitely should've been called.
		await delay(10000);
		assert.ok(getPackagesCommand.called);
	});
});
