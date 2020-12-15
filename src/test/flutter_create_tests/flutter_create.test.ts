import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import * as vs from "vscode";
import { dartCodeExtensionIdentifier } from "../../shared/constants";
import { LogCategory } from "../../shared/enums";
import { internalApiSymbol } from "../../shared/symbols";
import { fsPath } from "../../shared/utils/fs";
import { InternalExtensionApi } from "../../shared/vscode/interfaces";
import { activate, logger, waitForResult } from "../helpers";

describe("flutter", () => {
	beforeEach("activate", () => activate());

	it("created a basic default project", async () => {
		const basicProjectFolder = fsPath(vs.workspace.workspaceFolders![0].uri);
		const pubspecFile = path.join(basicProjectFolder, "lib", "main.dart");

		await projectFileContainsExpectedString(pubspecFile, "title: 'Flutter Demo'");
	});

	it("created a sample project", async () => {
		const sampleProjectFolder = fsPath(vs.workspace.workspaceFolders![1].uri);
		const pubspecFile = path.join(sampleProjectFolder, "lib", "main.dart");

		await projectFileContainsExpectedString(pubspecFile, "This sample shows an `IconButton` that");
	});

	it("created a module project", async () => {
		const moduleProjectFolder = fsPath(vs.workspace.workspaceFolders![2].uri);
		const pubspecFile = path.join(moduleProjectFolder, "pubspec.yaml");

		await projectFileContainsExpectedString(pubspecFile, "description: A new flutter module project");
	});

	it("created a package project", async () => {
		const packageProjectFolder = fsPath(vs.workspace.workspaceFolders![3].uri);
		const pubspecFile = path.join(packageProjectFolder, "pubspec.yaml");

		await projectFileContainsExpectedString(pubspecFile, "description: A new Flutter package project");
	});

	it("created a plugin project", async () => {
		const pluginProjectFolder = fsPath(vs.workspace.workspaceFolders![4].uri);
		const pubspecFile = path.join(pluginProjectFolder, "pubspec.yaml");

		await projectFileContainsExpectedString(pubspecFile, "description: A new flutter plugin project");
	});

	it("triggered Flutter mode", () => {
		const ext = vs.extensions.getExtension(dartCodeExtensionIdentifier);
		assert.ok(ext);
		assert.ok(ext.isActive);

		const api: InternalExtensionApi = ext.exports[internalApiSymbol];
		assert.equal(api.workspaceContext.hasAnyFlutterProjects, true);
	});

});

async function projectFileContainsExpectedString(fileToCheck: string, expectedString: string): Promise<void> {
	// Creating the project may be a little slow, so allow up to 60 seconds for it.
	logger.info("Waiting for file to exist", LogCategory.CI);
	await waitForResult(() => fs.existsSync(fileToCheck), `${fileToCheck} did not exist`, 100000);

	// Wait for up to 10 seconds for the content to match, as the file may be updated after creation.
	logger.info("Waiting for content match", LogCategory.CI);
	await waitForResult(() => {
		const contents = fs.readFileSync(fileToCheck);
		return contents.indexOf(expectedString) !== -1;
	}, undefined, 10000, false); // Don't throw on failure as we have a better assert below that can include the contents.

	const contents = fs.readFileSync(fileToCheck);
	if (contents.indexOf(expectedString) === -1)
		assert.fail(`Did not find "${expectedString}'" in the file (${fileToCheck}):\n\n${contents}`);
}
