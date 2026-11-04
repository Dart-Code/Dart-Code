import { strict as assert } from "assert";
import * as fs from "fs";
import * as path from "path";
import * as sinon from "sinon";
import * as vs from "vscode";
import { DART_CREATE_PROJECT_TRIGGER_FILE } from "../../../shared/constants";
import { DartProjectTemplate } from "../../../shared/interfaces";
import { activate, defer, getRandomTempFolder, privateApi, sb, tryDelete } from "../../helpers";
import { ChildProcessSpawnStub } from "../../mocks/child_process_spawn_stub";

describe("dart commands", () => {
	before("activate", () => activate());

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

	/**
	 * Stubs the `dart create --list-templates` spawn so the template fetch
	 * resolves with `result` JSON.
	 */
	function stubTemplateFetch(result: DartProjectTemplate[] = templates) {
		return ChildProcessSpawnStub.dartCreate({ stdout: JSON.stringify(result) });
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
		const create = ChildProcessSpawnStub.dartCreate();
		const showDartActivationFailure = sb.stub(privateApi.sdkUtils!, "showDartActivationFailure");
		sb.stub(privateApi.workspaceContext.sdks, "dart").value(undefined);

		await vs.commands.executeCommand("dart.createProject");

		assert.ok(showDartActivationFailure.calledOnceWithExactly("dart.createProject"));
		assert.equal(create.calls.length, 0, "project templates should not be fetched without an SDK");
	});

	it("shows an error and does not prompt when project templates cannot be fetched", async () => {
		ChildProcessSpawnStub.dartCreate({ exitCode: 1 });
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

	it("validates project names against invalid, reserved and duplicate names", () => {
		const tempFolder = tempFolderWithCleanup();
		fs.mkdirSync(path.join(tempFolder, "existing_project"));

		const validate = (value: string) => privateApi.dartCommands.validateDartProjectName(value, tempFolder);

		assert.equal(
			validate("InvalidName"),
			"Dart project names should be all lowercase, with underscores to separate words",
		);
		assert.equal(
			validate("1invalid"),
			"Dart project names should be all lowercase, with underscores to separate words",
		);
		for (const reserved of ["dart", "test", "this"])
			assert.equal(validate(reserved), `You may not use ${reserved} as the name for a dart project`);
		assert.equal(
			validate("existing_project"),
			"A project with this name already exists within the selected directory",
		);
		assert.equal(validate("valid_project_name_1"), undefined);
	});

	for (const [templateName, expectedKind] of [
		["package", "package"],
		["web", "web_application"],
		["console", "application"],
	] as const) {
		it(`uses project kind "${expectedKind}" for the "${templateName}" template`, () => {
			assert.equal(privateApi.dartCommands.getProjectKind(templateName), expectedKind);
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

	it("creates the project folder, trigger file, SDK setting and opens the folder", async () => {
		stubTemplateFetch();
		stubTemplatePick("console");
		const tempFolder = tempFolderWithCleanup();
		stubFolderPick(tempFolder);
		sb.stub(vs.window, "showInputBox").resolves("my_test_project");
		const openFolder = stubOpenFolder();

		// Use the real SDK path as the configured value: it is a valid path,
		// so it cannot interfere with the SDKs the extension resolves.
		const customSdkPath = privateApi.workspaceContext.sdks.dart;
		sb.stub(privateApi.config, "workspaceSdkPath").get(() => customSdkPath);

		await vs.commands.executeCommand("dart.createProject");

		assert.ok(openFolder.calledOnce);
		const projectFolder = path.join(tempFolder, "my_test_project");
		const triggerFile = path.join(projectFolder, DART_CREATE_PROJECT_TRIGGER_FILE);
		assert.ok(fs.existsSync(triggerFile));
		const recordedTemplate = JSON.parse(fs.readFileSync(triggerFile).toString()) as DartProjectTemplate;
		assert.equal(recordedTemplate.name, "console");

		const settingsFile = path.join(projectFolder, ".vscode", "settings.json");
		const settings = JSON.parse(fs.readFileSync(settingsFile, "utf8")) as Record<string, unknown>;
		assert.equal(settings["dart.sdkPath"], customSdkPath);
	});

	it("runs dart create for the selected template in the project folder", async () => {
		const create = ChildProcessSpawnStub.dartCreate();
		const tempFolder = tempFolderWithCleanup();

		await vs.commands.executeCommand("_dart.create", tempFolder, "package");

		create.assertDartCalls([{
			args: ["create", "-t", "package", ".", "--force"],
			cwd: tempFolder,
		}]);
	});
});
