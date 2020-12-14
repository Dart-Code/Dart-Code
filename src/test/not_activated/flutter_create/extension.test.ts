import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import * as sinon from "sinon";
import * as vs from "vscode";
import { FLUTTER_CREATE_PROJECT_TRIGGER_FILE } from "../../../shared/constants";
import { FlutterCreateTriggerData } from "../../../shared/interfaces";
import { fsPath } from "../../../shared/utils/fs";
import { FlutterSampleSnippet } from "../../../shared/vscode/interfaces";
import { attachLoggingWhenExtensionAvailable, ext, getRandomTempFolder, sb } from "../../helpers";

describe("test environment", () => {
	it("has opened the correct folder", () => {
		const wfs = vs.workspace.workspaceFolders || [];
		assert.equal(wfs.length, 1);
		assert.ok(
			fsPath(wfs[0].uri).endsWith(path.sep + "empty"),
			`${fsPath(wfs[0].uri)} doesn't end with ${path.sep}empty`,
		);
	});
});

describe("extension", () => {
	it("did not activate", async () => {
		assert.equal(ext.isActive, false);
	});
});

// Note: We can only really have one "real" test here because it'll activate the extension.
// Other tests must go in their own folders and be listed in test_all/launch.json individually.

describe("command", () => {
	it("Flutter: New Application Project can be invoked and creates trigger file", async () => {
		attachLoggingWhenExtensionAvailable();

		const showOpenDialog = sb.stub(vs.window, "showOpenDialog");
		const tempFolder = getRandomTempFolder();
		showOpenDialog.resolves([vs.Uri.file(tempFolder)]);

		const showInputBox = sb.stub(vs.window, "showInputBox");
		showInputBox.resolves("my_test_flutter_proj");

		// Create some folders in the temp folder to check the default name is correctly incremented.
		fs.mkdirSync(path.join(tempFolder, "flutter_application_1"));
		fs.mkdirSync(path.join(tempFolder, "flutter_application_2"));

		// Intercept executeCommand for openFolder so we don't spawn a new instance of Code!
		const executeCommand = sb.stub(vs.commands, "executeCommand").callThrough();
		const openFolder = executeCommand.withArgs("vscode.openFolder", sinon.match.any).resolves();

		await vs.commands.executeCommand("flutter.createProject");

		assert.ok(showInputBox.calledOnceWith(sinon.match.has("value", "flutter_application_3")));
		assert.ok(showOpenDialog.calledOnce);
		assert.ok(openFolder.calledOnce);
		assert.ok(fs.existsSync(path.join(tempFolder, "my_test_flutter_proj", FLUTTER_CREATE_PROJECT_TRIGGER_FILE)));
	});

	it("Flutter: New Module Project can be invoked and creates trigger file", async () => {
		attachLoggingWhenExtensionAvailable();

		const showOpenDialog = sb.stub(vs.window, "showOpenDialog");
		const tempFolder = getRandomTempFolder();
		showOpenDialog.resolves([vs.Uri.file(tempFolder)]);

		const showInputBox = sb.stub(vs.window, "showInputBox");
		showInputBox.resolves("my_test_flutter_proj");

		// Create some folders in the temp folder to check the default name is correctly incremented.
		fs.mkdirSync(path.join(tempFolder, "flutter_application_1"));
		fs.mkdirSync(path.join(tempFolder, "flutter_application_2"));

		// Intercept executeCommand for openFolder so we don't spawn a new instance of Code!
		const executeCommand = sb.stub(vs.commands, "executeCommand").callThrough();
		const openFolder = executeCommand.withArgs("vscode.openFolder", sinon.match.any).resolves();
		const projectFolderUri: string | undefined = await vs.commands.executeCommand("flutter.createProject.module");

		assert.ok(projectFolderUri);
		assert.ok(showInputBox.calledOnceWith(sinon.match.has("value", "flutter_application_3")));
		assert.ok(showOpenDialog.calledOnce);
		assert.ok(openFolder.calledOnce);

		const triggerFile = path.join(fsPath(projectFolderUri), FLUTTER_CREATE_PROJECT_TRIGGER_FILE);
		assert.ok(fs.existsSync(triggerFile));

		const jsonString: string | undefined = fs.readFileSync(triggerFile).toString().trim();
		const json = jsonString ? JSON.parse(jsonString) as FlutterCreateTriggerData : undefined;

		assert.equal(json?.template === "module", true);
	});

	it("Flutter: New Package Project can be invoked and creates trigger file", async () => {
		attachLoggingWhenExtensionAvailable();

		const showOpenDialog = sb.stub(vs.window, "showOpenDialog");
		const tempFolder = getRandomTempFolder();
		showOpenDialog.resolves([vs.Uri.file(tempFolder)]);

		const showInputBox = sb.stub(vs.window, "showInputBox");
		showInputBox.resolves("my_test_flutter_proj");

		// Create some folders in the temp folder to check the default name is correctly incremented.
		fs.mkdirSync(path.join(tempFolder, "flutter_application_1"));
		fs.mkdirSync(path.join(tempFolder, "flutter_application_2"));

		// Intercept executeCommand for openFolder so we don't spawn a new instance of Code!
		const executeCommand = sb.stub(vs.commands, "executeCommand").callThrough();
		const openFolder = executeCommand.withArgs("vscode.openFolder", sinon.match.any).resolves();
		const projectFolderUri: string | undefined = await vs.commands.executeCommand("flutter.createProject.package");

		assert.ok(projectFolderUri);
		assert.ok(showInputBox.calledOnceWith(sinon.match.has("value", "flutter_application_3")));
		assert.ok(showOpenDialog.calledOnce);
		assert.ok(openFolder.calledOnce);

		const triggerFile = path.join(fsPath(projectFolderUri), FLUTTER_CREATE_PROJECT_TRIGGER_FILE);
		assert.ok(fs.existsSync(triggerFile));

		const jsonString: string | undefined = fs.readFileSync(triggerFile).toString().trim();
		const json = jsonString ? JSON.parse(jsonString) as FlutterCreateTriggerData : undefined;

		assert.equal(json?.template === "package", true);
	});

	it("Flutter: New Plugin Project can be invoked and creates trigger file", async () => {
		attachLoggingWhenExtensionAvailable();

		const showOpenDialog = sb.stub(vs.window, "showOpenDialog");
		const tempFolder = getRandomTempFolder();
		showOpenDialog.resolves([vs.Uri.file(tempFolder)]);

		const showInputBox = sb.stub(vs.window, "showInputBox");
		showInputBox.resolves("my_test_flutter_proj");

		// Create some folders in the temp folder to check the default name is correctly incremented.
		fs.mkdirSync(path.join(tempFolder, "flutter_application_1"));
		fs.mkdirSync(path.join(tempFolder, "flutter_application_2"));

		// Intercept executeCommand for openFolder so we don't spawn a new instance of Code!
		const executeCommand = sb.stub(vs.commands, "executeCommand").callThrough();
		const openFolder = executeCommand.withArgs("vscode.openFolder", sinon.match.any).resolves();
		const projectFolderUri: string | undefined = await vs.commands.executeCommand("flutter.createProject.plugin");

		assert.ok(projectFolderUri);
		assert.ok(showInputBox.calledOnceWith(sinon.match.has("value", "flutter_application_3")));
		assert.ok(showOpenDialog.calledOnce);
		assert.ok(openFolder.calledOnce);

		const triggerFile = path.join(fsPath(projectFolderUri), FLUTTER_CREATE_PROJECT_TRIGGER_FILE);
		assert.ok(fs.existsSync(triggerFile));

		const jsonString: string | undefined = fs.readFileSync(triggerFile).toString().trim();
		const json = jsonString ? JSON.parse(jsonString) as FlutterCreateTriggerData : undefined;

		assert.equal(json?.template === "plugin", true);
	});

	it("Flutter: Create Sample Project can be invoked and creates trigger file", async () => {
		const showQuickPick = sb.stub(vs.window, "showQuickPick");
		type SnippetOption = vs.QuickPickItem & { snippet: FlutterSampleSnippet };
		// TODO: Remove "material.IconButton" without the suffix after the next stable Flutter release (the one after v1.2).
		showQuickPick.callsFake((items: SnippetOption[]) => items.find((s) => s.snippet.id === "material.IconButton" || s.snippet.id === "material.IconButton.1"));

		// Intercept executeCommand for openFolder so we don't spawn a new instance of Code!
		const executeCommand = sb.stub(vs.commands, "executeCommand").callThrough();
		const openFolder = executeCommand.withArgs("vscode.openFolder", sinon.match.any).resolves();

		const sampleFolderUri: string | undefined = await vs.commands.executeCommand("_dart.flutter.createSampleProject");

		assert.ok(sampleFolderUri);
		assert.ok(showQuickPick.calledOnce);
		assert.ok(openFolder.calledOnce);
		const triggerFile = path.join(fsPath(sampleFolderUri), FLUTTER_CREATE_PROJECT_TRIGGER_FILE);
		assert.ok(fs.existsSync(triggerFile));

		const jsonString: string | undefined = fs.readFileSync(triggerFile).toString().trim();
		const json = jsonString ? JSON.parse(jsonString) as FlutterCreateTriggerData : undefined;

		// TODO: Remove next line and uncomment the following one after the next stable Flutter release (the one after v1.2).
		assert.equal(json?.sample === "material.IconButton" || json?.sample === "material.IconButton.1", true);
		// assert.equal(recordedSampleId, "material.IconButton.1");
	});
});
