import { strict as assert } from "assert";
import * as fs from "fs";
import * as path from "path";
import * as sinon from "sinon";
import * as vs from "vscode";
import { FLUTTER_CREATE_PROJECT_TRIGGER_FILE } from "../../../shared/constants";
import { FlutterCreateTriggerData } from "../../../shared/interfaces";
import { fsPath } from "../../../shared/utils/fs";
import { FlutterSampleSnippet } from "../../../shared/vscode/interfaces";
import { attachLoggingWhenExtensionAvailable, ext, getRandomTempFolder, privateApi, sb, stubCreateInputBox } from "../../helpers";

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
	// Skipped due to https://github.com/microsoft/vscode/issues/266221
	it.skip("did not activate", async () => {
		assert.equal(ext.isActive, false);
	});
});

// Note: We can only really have one "real" test here because it'll activate the extension.
// Other tests must go in their own folders and be listed in test_all/launch.json individually.

describe("command", () => {
	it("Flutter: New Project can be invoked and creates app trigger file", async () => {
		await projectContainsTriggerFileForExpectedTemplate("flutter.createProject", "app", "application");
	});

	it("Flutter: New Project can be invoked and creates module trigger file", async () => {
		await projectContainsTriggerFileForExpectedTemplate("flutter.createProject", "module", "module");
	});

	it("Flutter: New Project can be invoked and creates package trigger file", async () => {
		await projectContainsTriggerFileForExpectedTemplate("flutter.createProject", "package", "package");
	});

	it("Flutter: New Project can be invoked and creates plugin trigger file", async () => {
		await projectContainsTriggerFileForExpectedTemplate("flutter.createProject", "plugin", "plugin");
	});

	it("Flutter: New Project can be invoked and creates skeleton trigger file", async function () {
		// Skip this test if skeleton template is not supported
		if (!privateApi?.flutterCapabilities?.supportsSkeleton) {
			this.skip();
			return;
		}

		await projectContainsTriggerFileForExpectedTemplate("flutter.createProject", "skeleton", "application");
	});

	it("Flutter: New Project can be invoked and creates empty application trigger file", async () => {
		await projectContainsTriggerFileForExpectedTemplate("flutter.createProject", "application", "application", true);
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
		const triggerFile = path.join(fsPath(vs.Uri.parse(sampleFolderUri)), FLUTTER_CREATE_PROJECT_TRIGGER_FILE);
		assert.ok(fs.existsSync(triggerFile));

		const jsonString: string | undefined = fs.readFileSync(triggerFile).toString().trim();
		const json = jsonString ? JSON.parse(jsonString) as FlutterCreateTriggerData : undefined;

		// TODO: Remove next line and uncomment the following one after the next stable Flutter release (the one after v1.2).
		assert.equal(json?.sample === "material.IconButton" || json?.sample === "material.IconButton.1", true);
		// assert.equal(recordedSampleId, "material.IconButton.1");
	});
});

async function projectContainsTriggerFileForExpectedTemplate(commandToExecute: string, expectedTemplate: string, expectedName: string, empty?: boolean): Promise<void> {
	attachLoggingWhenExtensionAvailable();

	// Return the expected project type from the prompt.
	const showQuickPick = sb.stub(vs.window, "showQuickPick");
	showQuickPick.resolves({ template: { id: expectedTemplate, empty } });

	// Choose a random temp folder for the project output.
	const showOpenDialog = sb.stub(vs.window, "showOpenDialog");
	const tempFolder = getRandomTempFolder();
	showOpenDialog.resolves([vs.Uri.file(tempFolder)]);

	const inputBox = stubCreateInputBox("my_test_flutter_proj");

	// Create some folders in the temp folder to check the default name is correctly incremented.
	fs.mkdirSync(path.join(tempFolder, `flutter_${expectedName}_1`));
	fs.mkdirSync(path.join(tempFolder, `flutter_${expectedName}_2`));

	// Intercept executeCommand for openFolder so we don't spawn a new instance of Code!
	const executeCommand = sb.stub(vs.commands, "executeCommand").callThrough();
	const openFolder = executeCommand.withArgs("vscode.openFolder", sinon.match.any).resolves();
	const projectFolderUri: string | undefined = await vs.commands.executeCommand(commandToExecute);

	assert.ok(projectFolderUri);
	assert.equal(inputBox.promptedValue, `flutter_${expectedName}_3`);
	assert.ok(showOpenDialog.calledOnce);
	assert.ok(openFolder.calledOnce);

	const triggerFile = path.join(fsPath(vs.Uri.parse(projectFolderUri)), FLUTTER_CREATE_PROJECT_TRIGGER_FILE);
	assert.ok(fs.existsSync(triggerFile));

	const jsonString: string | undefined = fs.readFileSync(triggerFile).toString().trim();
	const json = jsonString ? JSON.parse(jsonString) as FlutterCreateTriggerData : undefined;

	assert.equal(json?.template, expectedTemplate);
	assert.equal(json?.empty, empty);
}
