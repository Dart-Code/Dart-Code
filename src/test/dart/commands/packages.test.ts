import { strict as assert } from "assert";
import * as fs from "fs";
import * as path from "path";
import * as vs from "vscode";
import { iUnderstandAction } from "../../../shared/constants";
import { fsPath } from "../../../shared/utils/fs";
import { activate, closeAllOpenFiles, defer, delay, helloWorldFolder, privateApi, sb, setConfigForTest, waitForResult } from "../../helpers";
import { ChildProcessSpawnStub } from "../../mocks/child_process_spawn_stub";

const nestedFlutterFolder = vs.Uri.file(path.join(fsPath(helloWorldFolder), "nested_flutter_example"));

describe("package commands", () => {
	before("activate", () => activate());

	function createPubspecIn(folder: string): void {
		const folderPath = path.join(fsPath(helloWorldFolder), folder);
		fs.mkdirSync(folderPath, { recursive: true });
		fs.writeFileSync(path.join(folderPath, "pubspec.yaml"), "name: pubspec_change_trigger\n");
		defer(`Delete ${folder}`, () => fs.rmSync(path.join(fsPath(helloWorldFolder), folder.split(path.sep)[0]), { recursive: true, force: true }));
	}

	describe("dart.upgradePackages.majorVersions", () => {
		beforeEach("reset upgrade warning", () => {
			privateApi.context.hasWarnedAboutPubUpgradeMajorVersionsPubpecMutation = false;
		});

		it("does nothing when pub is disabled", async () => {
			await setConfigForTest("dart", "enablePub", false);
			const showWarningMessage = sb.stub(vs.window, "showWarningMessage").resolves(iUnderstandAction);
			const spawn = ChildProcessSpawnStub.dartOrFlutterPub();

			await vs.commands.executeCommand("dart.upgradePackages.majorVersions", helloWorldFolder);

			assert.ok(showWarningMessage.notCalled);
			spawn.assertCalls([]);
		});

		it("does not run when the warning is dismissed", async () => {
			const showWarningMessage = sb.stub(vs.window, "showWarningMessage").resolves();
			const spawn = ChildProcessSpawnStub.dartOrFlutterPub();

			await vs.commands.executeCommand("dart.upgradePackages.majorVersions", helloWorldFolder);

			assert.ok(showWarningMessage.calledOnce);
			assert.strictEqual(privateApi.context.hasWarnedAboutPubUpgradeMajorVersionsPubpecMutation, false);
			spawn.assertCalls([]);
		});

		it("runs dart pub upgrade --major-versions when the warning is accepted", async () => {
			sb.stub(vs.window, "showWarningMessage").resolves(iUnderstandAction);
			const spawn = ChildProcessSpawnStub.dartPub();

			await vs.commands.executeCommand("dart.upgradePackages.majorVersions", helloWorldFolder);

			assert.strictEqual(privateApi.context.hasWarnedAboutPubUpgradeMajorVersionsPubpecMutation, true);
			spawn.assertDartCalls([{ cwd: fsPath(helloWorldFolder), args: ["pub", "upgrade", "--major-versions"] }]);
		});

		it("does not show the warning again once acknowledged", async () => {
			privateApi.context.hasWarnedAboutPubUpgradeMajorVersionsPubpecMutation = true;
			const showWarningMessage = sb.stub(vs.window, "showWarningMessage").resolves(iUnderstandAction);
			const spawn = ChildProcessSpawnStub.dartPub();

			await vs.commands.executeCommand("dart.upgradePackages.majorVersions", helloWorldFolder);
			await vs.commands.executeCommand("dart.upgradePackages.majorVersions", helloWorldFolder);

			assert.ok(showWarningMessage.notCalled);
			spawn.assertDartCalls([
				{ cwd: fsPath(helloWorldFolder), args: ["pub", "upgrade", "--major-versions"] },
				{ cwd: fsPath(helloWorldFolder), args: ["pub", "upgrade", "--major-versions"] },
			]);
		});

		it("does nothing when folder selection is cancelled", async () => {
			privateApi.context.hasWarnedAboutPubUpgradeMajorVersionsPubpecMutation = true;
			await closeAllOpenFiles();
			sb.stub(vs.window, "showQuickPick").resolves();
			const spawn = ChildProcessSpawnStub.dartOrFlutterPub();

			await vs.commands.executeCommand("dart.upgradePackages.majorVersions");

			spawn.assertCalls([]);
		});

		it("runs flutter pub upgrade --major-versions for a Flutter project", async function () {
			if (!privateApi.workspaceContext.sdks.flutter)
				this.skip();
			privateApi.context.hasWarnedAboutPubUpgradeMajorVersionsPubpecMutation = true;
			const spawn = ChildProcessSpawnStub.flutterPub();

			await vs.commands.executeCommand("dart.upgradePackages.majorVersions", nestedFlutterFolder);

			spawn.assertFlutterCalls([{ cwd: fsPath(nestedFlutterFolder), args: ["pub", "upgrade", "--major-versions"] }]);
		});
	});

	describe("dart.getPackages", () => {
		it("runs dart pub get for a Dart project", async () => {
			const spawn = ChildProcessSpawnStub.dartPub();

			await vs.commands.executeCommand("dart.getPackages", helloWorldFolder);

			spawn.assertDartCalls([{ cwd: fsPath(helloWorldFolder), args: ["pub", "get", "--no-example"] }]);
		});

		it("does nothing when pub is disabled", async () => {
			await setConfigForTest("dart", "enablePub", false);
			const spawn = ChildProcessSpawnStub.dartOrFlutterPub();

			await vs.commands.executeCommand("dart.getPackages", helloWorldFolder);

			spawn.assertCalls([]);
		});

		it("does nothing when folder selection is cancelled", async () => {
			await closeAllOpenFiles();
			sb.stub(vs.window, "showQuickPick").resolves();
			const spawn = ChildProcessSpawnStub.dartOrFlutterPub();

			await vs.commands.executeCommand("dart.getPackages");

			spawn.assertCalls([]);
		});
	});

	describe("dart.upgradePackages", () => {
		it("runs dart pub upgrade for a Dart project", async () => {
			const spawn = ChildProcessSpawnStub.dartPub();

			await vs.commands.executeCommand("dart.upgradePackages", helloWorldFolder);

			spawn.assertDartCalls([{ cwd: fsPath(helloWorldFolder), args: ["pub", "upgrade"] }]);
		});

		it("does nothing when pub is disabled", async () => {
			await setConfigForTest("dart", "enablePub", false);
			const spawn = ChildProcessSpawnStub.dartOrFlutterPub();

			await vs.commands.executeCommand("dart.upgradePackages", helloWorldFolder);

			spawn.assertCalls([]);
		});

		it("does nothing when folder selection is cancelled", async () => {
			await closeAllOpenFiles();
			sb.stub(vs.window, "showQuickPick").resolves();
			const spawn = ChildProcessSpawnStub.dartOrFlutterPub();

			await vs.commands.executeCommand("dart.upgradePackages");

			spawn.assertCalls([]);
		});
	});

	describe("dart.listOutdatedPackages", () => {
		it("runs dart pub outdated for a Dart project", async () => {
			const spawn = ChildProcessSpawnStub.dartPub();

			await vs.commands.executeCommand("dart.listOutdatedPackages", helloWorldFolder);

			spawn.assertDartCalls([{ cwd: fsPath(helloWorldFolder), args: ["pub", "outdated"] }]);
		});

		it("does nothing when pub is disabled", async () => {
			await setConfigForTest("dart", "enablePub", false);
			const spawn = ChildProcessSpawnStub.dartOrFlutterPub();

			await vs.commands.executeCommand("dart.listOutdatedPackages", helloWorldFolder);

			spawn.assertCalls([]);
		});

		it("does nothing when folder selection is cancelled", async () => {
			await closeAllOpenFiles();
			sb.stub(vs.window, "showQuickPick").resolves();
			const spawn = ChildProcessSpawnStub.dartOrFlutterPub();

			await vs.commands.executeCommand("dart.listOutdatedPackages");

			spawn.assertCalls([]);
		});
	});

	describe("pubspec watcher", () => {
		it("fetches packages when a pubspec is modified", async () => {
			const fetchPackagesOrPrompt = sb.stub(privateApi.packageCommands, "fetchPackagesOrPrompt").resolves();

			createPubspecIn("pubspec_trigger_tmp");

			await waitForResult(() => fetchPackagesOrPrompt.calledOnce);
		});

		it("ignores pubspecs in hidden folders", async () => {
			const fetchPackagesOrPrompt = sb.stub(privateApi.packageCommands, "fetchPackagesOrPrompt").resolves();
			const infoLogs = sb.stub(privateApi.logger, "info");

			createPubspecIn(path.join("pubspec_hidden_tmp", ".hidden"));

			await waitForResult(() => infoLogs.getCalls().some((call) => String(call.args[0]).includes("Skipping pubspec change for ignored folder")));
			await delay(1200); // Allow time for any (incorrect) debounced fetch to fire.
			assert.ok(fetchPackagesOrPrompt.notCalled);
		});

		it("ignores pubspecs in build folders that were not saved in the editor", async () => {
			const fetchPackagesOrPrompt = sb.stub(privateApi.packageCommands, "fetchPackagesOrPrompt").resolves();
			const infoLogs = sb.stub(privateApi.logger, "info");

			createPubspecIn(path.join("pubspec_build_tmp", "build"));

			await waitForResult(() => infoLogs.getCalls().some((call) => String(call.args[0]).includes("Skipping pubspec change for ignored folder")));
			await delay(1200);
			assert.ok(fetchPackagesOrPrompt.notCalled);
		});

		it("does not fetch when automatic pub get is disabled", async () => {
			await setConfigForTest("dart", "runPubGetOnPubspecChanges", "never");
			const fetchPackagesOrPrompt = sb.stub(privateApi.packageCommands, "fetchPackagesOrPrompt").resolves();
			const infoLogs = sb.stub(privateApi.logger, "info");

			createPubspecIn("pubspec_disabled_tmp");

			await waitForResult(() => infoLogs.getCalls().some((call) => String(call.args[0]).includes('Automatically running "pub get" is disabled')));
			await delay(1200);
			assert.ok(fetchPackagesOrPrompt.notCalled);
		});

		it("does not fetch when the workspace suppresses automatic pub", async () => {
			sb.stub(privateApi.workspaceContext, "config").value({ ...privateApi.workspaceContext.config, disableAutomaticPub: true });
			const fetchPackagesOrPrompt = sb.stub(privateApi.packageCommands, "fetchPackagesOrPrompt").resolves();
			const infoLogs = sb.stub(privateApi.logger, "info");

			createPubspecIn("pubspec_suppressed_tmp");

			await waitForResult(() => infoLogs.getCalls().some((call) => String(call.args[0]).includes('Workspace suppresses automatic "pub"')));
			await delay(1200);
			assert.ok(fetchPackagesOrPrompt.notCalled);
		});

		it("does not fetch while project creation is in progress", async () => {
			privateApi.commandState.numProjectCreationsInProgress++;
			defer("Reset project creation count", () => privateApi.commandState.numProjectCreationsInProgress--);
			const fetchPackagesOrPrompt = sb.stub(privateApi.packageCommands, "fetchPackagesOrPrompt").resolves();
			const infoLogs = sb.stub(privateApi.logger, "info");

			createPubspecIn("pubspec_creating_tmp");

			await waitForResult(() => infoLogs.getCalls().some((call) => String(call.args[0]).includes("Skipping package fetch because project creation is in progress")));
			await delay(1200);
			assert.ok(fetchPackagesOrPrompt.notCalled);
		});
	});
});
