import { strict as assert } from "assert";
import * as fs from "fs";
import * as path from "path";
import * as sinon from "sinon";
import * as vs from "vscode";
import { defaultLaunchJson, ExtensionRestartReason, flutterCreateAvailablePlatforms } from "../../../shared/constants";
import { DebuggerType } from "../../../shared/enums";
import { fsPath } from "../../../shared/utils/fs";
import { startFakeDebugSession } from "../../debug_helpers";
import { activate, flutterHelloWorldFolder, getRandomTempFolder, privateApi, sb, setConfigForTest } from "../../helpers";

describe("flutter commands", () => {
	before("activate", () => activate());

	it("flutterScreenshot uses the configured output folder and active debug session", async () => {
		const screenshotFolder = getRandomTempFolder();
		const runFlutterInFolder = sb.stub(privateApi.flutterCommands, "runFlutterInFolder").resolves(undefined);
		const session = startFakeDebugSession({ debuggerType: DebuggerType.Flutter, name: "Fake Debug Session (flutter command tests)" });
		session.configuration.cwd = fsPath(flutterHelloWorldFolder);
		session.configuration.deviceId = "emulator-5554";

		await setConfigForTest("dart", "flutterScreenshotPath", screenshotFolder);
		sb.stub(vs.debug, "activeDebugSession").value(session);
		const showInformationMessage = sb.stub(vs.window, "showInformationMessage").resolves(undefined);
		const showOpenDialog = sb.stub(vs.window, "showOpenDialog");

		await vs.commands.executeCommand("flutter.screenshot");

		assert.ok(showOpenDialog.notCalled);
		assert.ok(runFlutterInFolder.calledOnce);
		assert.equal(runFlutterInFolder.firstCall.args[0], fsPath(flutterHelloWorldFolder));
		assert.deepEqual(runFlutterInFolder.firstCall.args[1], [
			"screenshot",
			"-d",
			"emulator-5554",
			"-o",
			path.join(screenshotFolder, "flutter_1.png"),
		]);
		assert.equal(runFlutterInFolder.firstCall.args[2], "screenshot");
		assert.ok(showInformationMessage.calledOnceWithExactly(`Screenshots will be saved to ${screenshotFolder}`, "Show Folder"));
	});

	it("flutterUpgrade runs flutter upgrade and prompts to reload the extension", async () => {
		const runFlutterInFolder = sb.stub(privateApi.flutterCommands, "runFlutterInFolder").resolves(undefined);
		const executeCommand = sb.stub(vs.commands, "executeCommand").callThrough();
		const reloadExtension = executeCommand.withArgs("_dart.reloadExtension", ExtensionRestartReason.AfterFlutterUpgrade, sinon.match.any).resolves();

		await vs.commands.executeCommand("flutter.upgrade");

		assert.ok(runFlutterInFolder.calledOnce);
		assert.deepEqual(runFlutterInFolder.firstCall.args[1], ["upgrade"]);
		assert.equal(runFlutterInFolder.firstCall.args[2], "flutter");
		assert.equal(runFlutterInFolder.firstCall.args[3], true);
		assert.ok(reloadExtension.calledOnce);
	});

	it("flutterCreate adds configured languages, org, offline mode, platform and template options", async () => {
		const projectFolder = getRandomTempFolder();
		const runFlutterInFolder = sb.stub(privateApi.flutterCommands, "runFlutterInFolder").resolves(0);

		await setConfigForTest("dart", "offline", true);
		await setConfigForTest("dart", "flutterCreatePlatforms", ["android", "ios"]);
		await setConfigForTest("dart", "flutterCreateOrganization", "com.example.test");
		await setConfigForTest("dart", "flutterCreateIOSLanguage", "objc");
		await setConfigForTest("dart", "flutterCreateAndroidLanguage", "java");
		sb.stub(privateApi.flutterCapabilities, "supportsIOSLanguage").get(() => true);

		const exitCode = await vs.commands.executeCommand<number>("_flutter.create", {
			packageName: "sample_app",
			packagePath: projectFolder,
			platform: "web",
			triggerData: { empty: true, template: "app" },
		});

		assert.equal(exitCode, 0);
		assert.ok(runFlutterInFolder.calledOnce);
		assert.equal(runFlutterInFolder.firstCall.args[0], projectFolder);
		assert.deepEqual(runFlutterInFolder.firstCall.args[1], [
			"create",
			"--offline",
			"--platforms",
			"web",
			"--project-name",
			"sample_app",
			"--org",
			"com.example.test",
			"--ios-language",
			"objc",
			"--android-language",
			"java",
			"--template",
			"app",
			"--overwrite",
			"--empty",
			".",
		]);
	});

	it("flutterCreate skips platform flags for templates that do not support platforms", async () => {
		const projectFolder = getRandomTempFolder();
		const runFlutterInFolder = sb.stub(privateApi.flutterCommands, "runFlutterInFolder").resolves(0);

		await setConfigForTest("dart", "offline", false);
		await setConfigForTest("dart", "flutterCreatePlatforms", ["android", "ios"]);
		await setConfigForTest("dart", "flutterCreateOrganization", undefined);
		await setConfigForTest("dart", "flutterCreateIOSLanguage", "objc");
		await setConfigForTest("dart", "flutterCreateAndroidLanguage", "kotlin");
		sb.stub(privateApi.flutterCapabilities, "supportsIOSLanguage").get(() => false);

		await vs.commands.executeCommand("_flutter.create", {
			packagePath: projectFolder,
			triggerData: { template: "module" },
		});

		assert.ok(runFlutterInFolder.calledOnce);
		assert.deepEqual(runFlutterInFolder.firstCall.args[1], [
			"create",
			"--template",
			"module",
			"--overwrite",
			".",
		]);
	});

	it("writeDefaultLaunchJson writes the default launch.json when one does not exist", () => {
		const projectFolder = getRandomTempFolder();

		privateApi.flutterCommands.writeDefaultLaunchJson(projectFolder);

		const launchJsonPath = path.join(projectFolder, ".vscode", "launch.json");
		assert.equal(fs.readFileSync(launchJsonPath, "utf8"), defaultLaunchJson);
	});

	it("getFlutterTemplates includes the skeleton template when supported", () => {
		sb.stub(privateApi.flutterCapabilities, "supportsSkeleton").get(() => true);

		const templates = privateApi.flutterCommands.getFlutterTemplates() as Array<{ label: string }>;

		assert.ok(templates.some((template) => template.label === "Skeleton Application"));
	});

	it("getFlutterTemplates omits the skeleton template when unsupported", () => {
		sb.stub(privateApi.flutterCapabilities, "supportsSkeleton").get(() => false);

		const templates = privateApi.flutterCommands.getFlutterTemplates() as Array<{ label: string }>;

		assert.ok(!templates.some((template) => template.label === "Skeleton Application"));
	});

	it("getCurrentFlutterCreateSettings exposes the current flutter create settings", async () => {
		await setConfigForTest("dart", "flutterCreateOrganization", undefined);
		await setConfigForTest("dart", "flutterCreateAndroidLanguage", "kotlin");
		await setConfigForTest("dart", "flutterCreateIOSLanguage", "swift");
		await setConfigForTest("dart", "offline", false);
		await setConfigForTest("dart", "flutterCreatePlatforms", undefined);

		const settings = privateApi.flutterCommands.getCurrentFlutterCreateSettings();
		const organizationSetting = settings[0];
		const platformsSetting = settings[4];

		assert.equal(settings.length, 5);
		assert.deepEqual(settings.map((setting: { label: string }) => setting.label), [
			"Organization",
			"Android Language",
			"iOS Language",
			"Offline Mode",
			"Platforms",
		]);
		assert.equal(organizationSetting.currentValue, "com.example");
		assert.equal(platformsSetting.description, "all");
		assert.deepEqual(platformsSetting.currentValue, flutterCreateAvailablePlatforms);

		// eslint-disable-next-line @typescript-eslint/no-unsafe-argument
		await organizationSetting.setValue("com.example.changed" as any);
		// eslint-disable-next-line @typescript-eslint/no-unsafe-argument
		await platformsSetting.setValue([...flutterCreateAvailablePlatforms] as any);

		assert.equal(vs.workspace.getConfiguration("dart").get("flutterCreateOrganization"), "com.example.changed");
		assert.equal(vs.workspace.getConfiguration("dart").inspect("flutterCreatePlatforms")?.globalValue, undefined);
	});
});
