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

	describe("settings editor", () => {
		it("updates the organization", async () => {
			const projectFolder = getRandomTempFolder();
			await setConfigForTest("dart", "flutterCreateOrganization", undefined);
			stubCreateInputBoxActions([
				{ kind: "settings" },
				{ kind: "accept", value: "valid_project" },
			]);
			stubCreateQuickPickActions([
				{ kind: "top-level-setting", label: "Organization" },
				{ kind: "cancel" },
			]);
			const showInputBox = sb.stub(vs.window, "showInputBox").resolves("com.example.changed");

			const result = await privateApi.flutterCommands.promptForNameWithSettings("valid_project", projectFolder);

			assert.equal(result, "valid_project");
			assert.ok(showInputBox.calledOnce);
			assert.equal(vs.workspace.getConfiguration("dart").get("flutterCreateOrganization"), "com.example.changed");
		});

		it("updates enum settings", async () => {
			const projectFolder = getRandomTempFolder();
			await setConfigForTest("dart", "flutterCreateAndroidLanguage", "kotlin");
			stubCreateInputBoxActions([
				{ kind: "settings" },
				{ kind: "accept", value: "enum_project" },
			]);
			stubCreateQuickPickActions([
				{ kind: "top-level-setting", label: "Android Language" },
				{ kind: "enum", label: "java" },
				{ kind: "cancel" },
			]);

			const result = await privateApi.flutterCommands.promptForNameWithSettings("enum_project", projectFolder);

			assert.equal(result, "enum_project");
			assert.equal(vs.workspace.getConfiguration("dart").get("flutterCreateAndroidLanguage"), "java");
		});

		it("updates boolean settings", async () => {
			const projectFolder = getRandomTempFolder();
			await setConfigForTest("dart", "offline", false);
			stubCreateInputBoxActions([
				{ kind: "settings" },
				{ kind: "accept", value: "offline_project" },
			]);
			stubCreateQuickPickActions([
				{ kind: "top-level-setting", label: "Offline Mode" },
				{ kind: "cancel" },
			]);
			const showQuickPick = sb.stub(vs.window, "showQuickPick").resolves({ label: "enable" } as vs.QuickPickItem);

			const result = await privateApi.flutterCommands.promptForNameWithSettings("offline_project", projectFolder);

			assert.equal(result, "offline_project");
			assert.ok(showQuickPick.calledOnce);
			assert.equal(vs.workspace.getConfiguration("dart").get("offline"), true);
		});

		it("updates multi-enum settings", async () => {
			const projectFolder = getRandomTempFolder();
			await setConfigForTest("dart", "flutterCreatePlatforms", undefined);
			stubCreateInputBoxActions([
				{ kind: "settings" },
				{ kind: "accept", value: "platform_project" },
			]);
			stubCreateQuickPickActions([
				{ kind: "top-level-setting", label: "Platforms" },
				{ kind: "multi", labels: ["android", "web"] },
				{ kind: "cancel" },
			]);

			const result = await privateApi.flutterCommands.promptForNameWithSettings("platform_project", projectFolder);

			assert.equal(result, "platform_project");
			assert.deepEqual(vs.workspace.getConfiguration("dart").get("flutterCreatePlatforms"), ["android", "web"]);
		});

		it("continues after cancelling the settings editor", async () => {
			const projectFolder = getRandomTempFolder();
			stubCreateInputBoxActions([
				{ kind: "settings" },
				{ kind: "accept", value: "cancel_project" },
			]);
			stubCreateQuickPickActions([{ kind: "cancel" }]);

			const result = await privateApi.flutterCommands.promptForNameWithSettings("cancel_project", projectFolder);

			assert.equal(result, "cancel_project");
		});
	});
});


/**
 * Scripted actions for the project-name input box shown by promptForNameWithSettings().
 */
type InputBoxAction =
	// Simulate clicking the settings button.
	| { kind: "settings" }
	// Simulate entering a project name and clicking accept.
	| { kind: "accept"; value: string };

/**
 * Scripted actions for the quick picks shown by the Flutter settings "dialog".
 */
type QuickPickAction =
	| { kind: "cancel" }
	// Select a top-level setting.
	| { kind: "top-level-setting"; label: string }
	// Select a single value.
	| { kind: "enum"; label: string }
	// Selecting multiple values.
	| { kind: "multi"; labels: string[] };

/**
 * Replaces createInputBox() with a deterministic scripted input box.
 *
 * This lets each test navigate through the real prompt/settings loop without needing
 * UI interaction (but still exercising the event handlers).
 */
function stubCreateInputBoxActions(actions: InputBoxAction[]) {
	const createInputBox = sb.stub(vs.window, "createInputBox");
	createInputBox.callsFake(() => {
		let acceptHandler: () => void;
		let changeHandler: (value: string) => void;
		let hideHandler: () => void;
		let triggerHandler: () => void;
		const input = {
			buttons: [] as vs.QuickInputButton[],
			dispose: sb.stub(),
			hide: () => hideHandler?.(),
			ignoreFocusOut: false,
			onDidAccept: (handler: () => void) => {
				acceptHandler = handler;
				return { dispose: () => undefined };
			},
			onDidChangeValue: (handler: (value: string) => void) => {
				changeHandler = handler;
				return { dispose: () => undefined };
			},
			onDidHide: (handler: () => void) => {
				hideHandler = handler;
				return { dispose: () => undefined };
			},
			onDidTriggerButton: (handler: () => void) => {
				triggerHandler = handler;
				return { dispose: () => undefined };
			},
			placeholder: undefined as string | undefined,
			prompt: undefined as string | undefined,
			show: () => {
				const action = actions.shift();
				if (!action)
					throw new Error("No more input box actions were available");

				// Defer callbacks until after the implementation code has finished wiring up
				// all event handlers.
				setImmediate(() => {
					if (action.kind === "settings") {
						triggerHandler?.();
					} else {
						input.value = action.value;
						changeHandler?.(action.value);
						acceptHandler?.();
					}
				});
			},
			title: undefined as string | undefined,
			validationMessage: undefined as string | undefined,
			value: "",
		};

		return input as unknown as vs.InputBox;
	});
}

/**
 * Replaces createQuickPick() with a scripted quick pick sequence.
 *
 * showSimpleSettingsEditor() reopens the top-level picker after each edit, so tests
 * provide a full sequence of actions (usually ending with a final "cancel").
 */
function stubCreateQuickPickActions(actions: QuickPickAction[]) {
	const createQuickPick = sb.stub(vs.window, "createQuickPick");
	createQuickPick.callsFake(() => {
		let acceptHandler: () => void;
		let hideHandler: () => void;
		const quickPick = {
			activeItems: [] as vs.QuickPickItem[],
			canSelectMany: false,
			dispose: sb.stub(),
			items: [] as vs.QuickPickItem[],
			onDidAccept: (handler: () => void) => {
				acceptHandler = handler;
				return { dispose: () => undefined };
			},
			onDidHide: (handler: () => void) => {
				hideHandler = handler;
				return { dispose: () => undefined };
			},
			placeholder: undefined as string | undefined,
			selectedItems: [] as vs.QuickPickItem[],
			show: () => {
				const action = actions.shift();
				if (!action)
					throw new Error("No more quick pick actions were available");

				// Defer callbacks until after the implementation code has finished wiring up
				// all event handlers.
				setImmediate(() => {
					switch (action.kind) {
						case "cancel":
							hideHandler?.();
							break;
						case "top-level-setting":
							quickPick.selectedItems = quickPick.items.filter((item) => item.label === action.label);
							acceptHandler?.();
							break;
						case "enum":
							quickPick.activeItems = quickPick.items.filter((item) => item.label === action.label);
							acceptHandler?.();
							break;
						case "multi":
							quickPick.selectedItems = quickPick.items.filter((item) => action.labels.includes(item.label));
							acceptHandler?.();
							break;
					}
				});
			},
			title: undefined as string | undefined,
		};

		return quickPick as unknown as vs.QuickPick<vs.QuickPickItem>;
	});
}
