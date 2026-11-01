import { strict as assert } from "assert";
import * as fs from "fs";
import * as path from "path";
import * as sinon from "sinon";
import * as vs from "vscode";
import { DART_CREATE_PROJECT_TRIGGER_FILE } from "../../../shared/constants";
import { DartProjectTemplate } from "../../../shared/interfaces";
import { activate, defer, delay, getRandomTempFolder, privateApi, sb, tryDelete, waitForResult } from "../../helpers";

describe("dart commands", () => {
	before("activate", () => activate());

	// The extension under test runs the bundled (out/dist) code, so class
	// stubs against out/src cannot intercept it. Instead the tests stub the
	// shared VS Code APIs, matching the existing convention in
	// src/test/not_activated/dart_create/extension.test.ts.

	type TemplatePickItem = vs.QuickPickItem & { template: DartProjectTemplate };

	const consoleTemplate: DartProjectTemplate = {
		categories: ["dart"],
		description: "A command-line application.",
		entrypoint: "bin/__projectName__.dart",
		label: "Console app",
		name: "console",
	};
	const packageTemplate: DartProjectTemplate = {
		categories: ["dart"],
		description: "A package containing shared Dart libraries.",
		entrypoint: "lib/__projectName__.dart",
		label: "Package",
		name: "package",
	};
	const webTemplate: DartProjectTemplate = {
		categories: ["web"],
		description: "A simple web application.",
		entrypoint: "web/main.dart",
		label: "Web app",
		name: "web",
	};
	const templates = [consoleTemplate, packageTemplate, webTemplate];

	/// Stubs the progress API so the template fetch resolves with
	/// [templates] JSON without spawning `dart create --list-templates`.
	/// Other progress calls are passed through to their task.
	function stubTemplateFetch(result: DartProjectTemplate[] = templates) {
		const templateJson = JSON.stringify(result);
		sb.stub(vs.window, "withProgress").callsFake((
			options: vs.ProgressOptions,
			task: (progress: vs.Progress<{ message?: string, increment?: number }>, token: vs.CancellationToken) => Thenable<unknown>,
		) => {
			if (options?.title === "Fetching project templates...")
				return Promise.resolve(templateJson);
			return task({ report: () => { } }, new vs.CancellationTokenSource().token);
		});
	}

	function stubTemplatePick(templateName: string | undefined) {
		const showQuickPick = sb.stub(vs.window, "showQuickPick");
		showQuickPick.callsFake((items: readonly TemplatePickItem[]) =>
			Promise.resolve(items.find((t) => t.template.name === templateName)),
		);
		return showQuickPick;
	}

	function stubFolderPick(folder: string | undefined) {
		const showOpenDialog = sb.stub(vs.window, "showOpenDialog");
		showOpenDialog.resolves(folder === undefined ? undefined : [vs.Uri.file(folder)]);
		return showOpenDialog;
	}

	function stubOpenFolder() {
		const executeCommand = sb.stub(vs.commands, "executeCommand").callThrough();
		return executeCommand.withArgs("vscode.openFolder", sinon.match.any).resolves();
	}

	function tempFolderWithCleanup() {
		const tempFolder = getRandomTempFolder();
		defer(`Delete temp folder ${tempFolder}`, () => tryDelete(tempFolder));
		return tempFolder;
	}

	it("shows an activation failure and does not fetch templates when no Dart SDK is configured", async () => {
		const withProgress = sb.stub(vs.window, "withProgress");
		const showDartActivationFailure = sb.stub(privateApi.sdkUtils!, "showDartActivationFailure").resolves();
		sb.stub(privateApi.workspaceContext.sdks, "dart").value(undefined);

		await vs.commands.executeCommand("dart.createProject");

		assert.ok(showDartActivationFailure.calledOnceWithExactly("dart.createProject"));
		assert.ok(withProgress.notCalled, "project templates should not be fetched without an SDK");
	});

	it("shows an error and does not prompt when project templates cannot be fetched", async () => {
		sb.stub(vs.window, "withProgress").rejects(new Error("something went wrong"));
		const showErrorMessage = sb.stub(vs.window, "showErrorMessage").resolves();
		const showQuickPick = sb.stub(vs.window, "showQuickPick");

		await vs.commands.executeCommand("dart.createProject");

		assert.ok(showErrorMessage.calledOnceWith(sinon.match("Unable to fetch project templates")));
		assert.ok(showQuickPick.notCalled);
	});

	it("does nothing when the template selection is cancelled", async () => {
		stubTemplateFetch();
		const showQuickPick = sb.stub(vs.window, "showQuickPick").resolves();
		const showOpenDialog = sb.stub(vs.window, "showOpenDialog");

		await vs.commands.executeCommand("dart.createProject");

		assert.ok(showQuickPick.calledOnce);
		assert.ok(showOpenDialog.notCalled);
	});

	it("does nothing when the folder selection is cancelled", async () => {
		stubTemplateFetch();
		stubTemplatePick("console");
		stubFolderPick(undefined);
		const showInputBox = sb.stub(vs.window, "showInputBox");

		await vs.commands.executeCommand("dart.createProject");

		assert.ok(showInputBox.notCalled);
	});

	it("does nothing when the name input is cancelled", async () => {
		stubTemplateFetch();
		stubTemplatePick("console");
		const tempFolder = tempFolderWithCleanup();
		stubFolderPick(tempFolder);
		const showInputBox = sb.stub(vs.window, "showInputBox").resolves();
		const openFolder = stubOpenFolder();

		await vs.commands.executeCommand("dart.createProject");

		assert.ok(showInputBox.calledOnce);
		assert.ok(openFolder.notCalled);
		assert.ok(
			fs.readdirSync(tempFolder).length === 0,
			"no project folder should be created when the name input is cancelled",
		);
	});

	it("validates project names against invalid, reserved and duplicate names", async () => {
		stubTemplateFetch();
		stubTemplatePick("console");
		const tempFolder = tempFolderWithCleanup();
		stubFolderPick(tempFolder);

		fs.mkdirSync(path.join(tempFolder, "existing_project"));

		let inputBoxOptions: vs.InputBoxOptions | undefined;
		const showInputBox = sb.stub(vs.window, "showInputBox");
		showInputBox.callsFake((options?: vs.InputBoxOptions) => {
			inputBoxOptions = options;
			return Promise.resolve(undefined);
		});

		await vs.commands.executeCommand("dart.createProject");

		assert.ok(showInputBox.calledOnceWith(sinon.match.has("validateInput")));
		const validate = (value: string) => inputBoxOptions!.validateInput!(value);

		assert.equal(
			await validate("InvalidName"),
			"Dart project names should be all lowercase, with underscores to separate words",
		);
		assert.equal(
			await validate("1invalid"),
			"Dart project names should be all lowercase, with underscores to separate words",
		);
		for (const reserved of ["dart", "test", "this"])
			assert.equal(await validate(reserved), `You may not use ${reserved} as the name for a dart project`);
		assert.equal(
			await validate("existing_project"),
			"A project with this name already exists within the selected directory",
		);
		assert.equal(await validate("valid_project_name_1"), undefined);
	});

	for (const [templateName, expectedPrefix] of [
		["package", "dart_package_"],
		["web", "dart_web_application_"],
		["console", "dart_application_"],
	] as const) {
		it(`uses project kind "${expectedPrefix}" for the "${templateName}" template`, async () => {
			stubTemplateFetch();
			stubTemplatePick(templateName);
			const tempFolder = tempFolderWithCleanup();
			stubFolderPick(tempFolder);
			const showInputBox = sb.stub(vs.window, "showInputBox").resolves();

			await vs.commands.executeCommand("dart.createProject");

			assert.ok(showInputBox.calledOnceWith(sinon.match.has("value", `${expectedPrefix}1`)));
		});
	}

	it("shows an error when the destination folder already exists", async () => {
		stubTemplateFetch();
		stubTemplatePick("console");
		const tempFolder = tempFolderWithCleanup();
		stubFolderPick(tempFolder);
		fs.mkdirSync(path.join(tempFolder, "existing_project"));
		sb.stub(vs.window, "showInputBox").resolves("existing_project");
		const showErrorMessage = sb.stub(vs.window, "showErrorMessage").resolves();
		const openFolder = stubOpenFolder();

		await vs.commands.executeCommand("dart.createProject");

		assert.ok(showErrorMessage.calledOnceWith(sinon.match("already exists")));
		assert.ok(openFolder.notCalled);
		assert.ok(!fs.existsSync(path.join(tempFolder, "existing_project", DART_CREATE_PROJECT_TRIGGER_FILE)));
	});

	it("creates the project folder, trigger file and opens the folder", async () => {
		stubTemplateFetch();
		stubTemplatePick("console");
		const tempFolder = tempFolderWithCleanup();
		stubFolderPick(tempFolder);
		sb.stub(vs.window, "showInputBox").resolves("my_test_project");
		const openFolder = stubOpenFolder();

		await vs.commands.executeCommand("dart.createProject");

		assert.ok(openFolder.calledOnce);
		const projectFolder = path.join(tempFolder, "my_test_project");
		const triggerFile = path.join(projectFolder, DART_CREATE_PROJECT_TRIGGER_FILE);
		assert.ok(fs.existsSync(triggerFile));
		const recordedTemplate = JSON.parse(fs.readFileSync(triggerFile).toString()) as DartProjectTemplate;
		assert.equal(recordedTemplate.name, "console");
	});

	it("writes the Dart SDK setting into the new project when a custom SDK is configured", async () => {
		stubTemplateFetch();
		stubTemplatePick("console");
		const tempFolder = tempFolderWithCleanup();
		stubFolderPick(tempFolder);
		sb.stub(vs.window, "showInputBox").resolves("my_sdk_project");

		// Changing dart.sdkPath triggers the extension's configuration-change
		// handler, which schedules a full extension reload via
		// commands.executeCommand("_dart.reloadExtension"). A reload that lands
		// while the analyzer is still starting can leave it in a broken state
		// and hang every subsequent suite, so the reload command is swallowed
		// here. This stub is not part of `sb` because it must outlive the test:
		// the config change from restoring the setting is dispatched
		// asynchronously and its reload timer can fire after the test ends.
		const executeCommand = sinon.stub(vs.commands, "executeCommand").callThrough();
		const openFolder = executeCommand.withArgs("vscode.openFolder", sinon.match.any).resolves();
		const reloadExtension = executeCommand.withArgs("_dart.reloadExtension").resolves();
		// Deferred functions run in reverse registration order, so the
		// workspace setting is restored before this stub is removed. The delay
		// lets any pending config-change reload timer fire into the swallow if
		// the explicit restore above did not run (e.g. a failed assertion).
		defer("Restore executeCommand stub", async () => {
			await delay(1000);
			executeCommand.restore();
		});

		// Use the real SDK path as the configured value: it is a valid path,
		// so it cannot interfere with the SDKs the extension resolves.
		const customSdkPath = privateApi.workspaceContext.sdks.dart;
		const dartConfig = vs.workspace.getConfiguration("dart");
		const previousSdkPath = dartConfig.inspect<string>("sdkPath")?.workspaceValue;
		defer("Restore workspace dart.sdkPath", async () => {
			await dartConfig.update("sdkPath", previousSdkPath, vs.ConfigurationTarget.Workspace);
		});
		await dartConfig.update("sdkPath", customSdkPath, vs.ConfigurationTarget.Workspace);

		await vs.commands.executeCommand("dart.createProject");

		assert.ok(openFolder.calledOnce);
		const settingsFile = path.join(tempFolder, "my_sdk_project", ".vscode", "settings.json");
		assert.ok(fs.existsSync(settingsFile), "a .vscode/settings.json should be created for the custom SDK");
		const settings = JSON.parse(fs.readFileSync(settingsFile).toString()) as Record<string, unknown>;
		assert.equal(settings["dart.sdkPath"], customSdkPath);

		await dartConfig.update("sdkPath", previousSdkPath, vs.ConfigurationTarget.Workspace);
		assert.equal(
			dartConfig.inspect<string>("sdkPath")?.workspaceValue,
			previousSdkPath,
			"the workspace dart.sdkPath setting should be restored",
		);

		// Wait for the configuration-change events from both updates to have
		// been dispatched and their reload commands swallowed, so no
		// _dart.reloadExtension remains pending when the stub is removed.
		await waitForResult(
			() => reloadExtension.callCount >= 2,
			"expected the dart.sdkPath changes to have triggered extension reloads",
			10000,
		);
	});
});
