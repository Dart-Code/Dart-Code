import { strict as assert } from "assert";
import * as path from "path";
import * as sinon from "sinon";
import * as vs from "vscode";
import { fsPath } from "../../../shared/utils/fs";
import { activate, defer, delay, helloWorldFolder, helloWorldPubspec, openFile, privateApi, sb, setConfigForTest, setTestContent, waitForResult } from "../../helpers";

describe("pub get", () => {
	before("activate", () => activate());
	before("skip if Pub issue", function () {
		if (privateApi.dartCapabilities.hasPackageConfigTimestampIssue)
			this.skip();
	});

	describe("handlePubspecChange", () => {
		// These tests run before any test that saves a pubspec in the editor below, so
		// no prior manual save reason can cause the build-folder check to be skipped.

		function pubspecIn(relativeDir: string): vs.Uri {
			return vs.Uri.file(path.join(fsPath(helloWorldFolder), relativeDir, "pubspec.yaml"));
		}

		it("ignores pubspecs in hidden folders", async () => {
			const fetchPackagesOrPrompt = sb.stub(privateApi.packageCommands, "fetchPackagesOrPrompt").resolves();
			const infoLogs = sb.spy(privateApi.logger, "info");

			privateApi.packageCommands.handlePubspecChange(pubspecIn(".hidden"));

			assert.ok(infoLogs.getCalls().some((call) => String(call.args[0]).includes("Skipping pubspec change for ignored folder")));
			assert.ok(fetchPackagesOrPrompt.notCalled);
		});

		it("ignores pubspecs in build folders that were not saved in the editor", async () => {
			const fetchPackagesOrPrompt = sb.stub(privateApi.packageCommands, "fetchPackagesOrPrompt").resolves();
			const infoLogs = sb.spy(privateApi.logger, "info");

			privateApi.packageCommands.handlePubspecChange(pubspecIn("build"));

			assert.ok(infoLogs.getCalls().some((call) => String(call.args[0]).includes("Skipping pubspec change for ignored folder")));
			assert.ok(fetchPackagesOrPrompt.notCalled);
		});

		it("does not fetch when automatic pub get is disabled", async () => {
			await setConfigForTest("dart", "runPubGetOnPubspecChanges", "never");
			const fetchPackagesOrPrompt = sb.stub(privateApi.packageCommands, "fetchPackagesOrPrompt").resolves();
			const infoLogs = sb.spy(privateApi.logger, "info");

			privateApi.packageCommands.handlePubspecChange(helloWorldPubspec);

			assert.ok(infoLogs.getCalls().some((call) => String(call.args[0]).includes('Automatically running "pub get" is disabled')));
			assert.ok(fetchPackagesOrPrompt.notCalled);
		});

		it("does not fetch when the workspace suppresses automatic pub", async () => {
			sb.stub(privateApi.workspaceContext, "config").value({ ...privateApi.workspaceContext.config, disableAutomaticPub: true });
			const fetchPackagesOrPrompt = sb.stub(privateApi.packageCommands, "fetchPackagesOrPrompt").resolves();
			const infoLogs = sb.spy(privateApi.logger, "info");

			privateApi.packageCommands.handlePubspecChange(helloWorldPubspec);

			assert.ok(infoLogs.getCalls().some((call) => String(call.args[0]).includes('Workspace suppresses automatic "pub"')));
			assert.ok(fetchPackagesOrPrompt.notCalled);
		});

		it("does not fetch while project creation is in progress", async () => {
			privateApi.commandState.numProjectCreationsInProgress++;
			defer("Reset project creation count", () => privateApi.commandState.numProjectCreationsInProgress--);
			const fetchPackagesOrPrompt = sb.stub(privateApi.packageCommands, "fetchPackagesOrPrompt").resolves();
			const infoLogs = sb.spy(privateApi.logger, "info");

			privateApi.packageCommands.handlePubspecChange(helloWorldPubspec);

			assert.ok(infoLogs.getCalls().some((call) => String(call.args[0]).includes("Skipping package fetch because project creation is in progress")));
			assert.ok(fetchPackagesOrPrompt.notCalled);
		});
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
