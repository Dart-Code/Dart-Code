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

		// Wait for 1s then ensure it still hadn't run.
		await delay(1000);
		assert.ok(!fetchPackagesOrPrompt.called);
	});

	it("runs delayed when pubspec is auto-saved", async () => {
		await setConfigForTest("files", "autoSave", "afterDelay");

		const fetchPackagesOrPrompt = sb.stub(privateApi.packageCommands, "fetchPackagesOrPrompt").withArgs(sinon.match.any, sinon.match.any).resolves();

		const editor = await openFile(helloWorldPubspec);
		const doc = editor.document;
		await setTestContent(doc.getText() + " # test");

		// Wait for 1sec and ensure it wasn't called.
		await delay(1000);
		assert.ok(!fetchPackagesOrPrompt.called);

		// Wait another 1s and make another change to test debouncing.
		await delay(1000);
		await setTestContent(doc.getText() + " # test");

		// Wait for 2sec and ensure it still wasn't called (because it was pushed back to 3sec again).
		await delay(2000);
		assert.ok(!fetchPackagesOrPrompt.called);

		// Wait for it to be called.
		await waitForResult(() => fetchPackagesOrPrompt.calledOnce);
	});
});
