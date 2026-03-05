import { strict as assert } from "assert";
import * as sinon from "sinon";
import { activate, delay, helloWorldPubspec, openFile, privateApi, sb, setConfigForTest, setTestContent, waitForResult } from "../../helpers";

describe("pub get", () => {
	before("activate", () => activate());
	before("skip if Pub issue", function () {
		if (privateApi.dartCapabilities.hasPackageConfigTimestampIssue)
			this.skip();
	});

	it("runs automatically when pubspec is saved", async () => {
		const fetchPackagesOrPrompt = sb.stub(privateApi.packageCommands, "fetchPackagesOrPrompt").withArgs(sinon.match.any, sinon.match.any).resolves();

		const editor = await openFile(helloWorldPubspec);
		const doc = editor.document;
		await setTestContent(doc.getText() + " # test");
		await doc.save();

		// Allow a short time for the command to be called because this is now a
		// file system watcher.
		await waitForResult(() => fetchPackagesOrPrompt.calledOnce);
	});

	it("does not run automatically if disabled", async () => {
		await setConfigForTest("dart", "runPubGetOnPubspecChanges", false);

		const fetchPackagesOrPrompt = sb.stub(privateApi.packageCommands, "fetchPackagesOrPrompt").withArgs(sinon.match.any, sinon.match.any).resolves();

		const editor = await openFile(helloWorldPubspec);
		const doc = editor.document;
		await setTestContent(doc.getText() + " # test");
		await doc.save();

		// Wait for 500ms then ensure it still hadn't run.
		await delay(500);
		assert.ok(!fetchPackagesOrPrompt.called);
	});

	it("runs delayed when pubspec is auto-saved", async () => {
		await setConfigForTest("files", "autoSave", "afterDelay");
		await setConfigForTest("files", "autoSaveDelay", 500);

		const fetchPackagesOrPrompt = sb.stub(privateApi.packageCommands, "fetchPackagesOrPrompt").withArgs(sinon.match.any, sinon.match.any).resolves();

		const editor = await openFile(helloWorldPubspec);
		const doc = editor.document;
		await setTestContent(doc.getText() + " # test");

		// Wait for 300ms and ensure it wasn't called.
		await delay(300);
		assert.ok(!fetchPackagesOrPrompt.called);

		// Wait another 300ms and make another change to test debouncing.
		await delay(300);
		await setTestContent(doc.getText() + " # test");

		// Wait for 600ms and ensure it still wasn't called (because it was pushed back to 1.5sec again).
		await delay(600);
		assert.ok(!fetchPackagesOrPrompt.called);

		// Wait for it to be called.
		await waitForResult(() => fetchPackagesOrPrompt.calledOnce);
	});
});
