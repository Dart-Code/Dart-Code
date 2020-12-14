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
		const expectedString = "title: 'Flutter Demo'";
		const mainFile = path.join(basicProjectFolder, "lib", "main.dart");
		// Creating the sample may be a little slow, so allow up to 60 seconds for it.
		logger.info("Waiting for file to exist", LogCategory.CI);
		await waitForResult(() => fs.existsSync(mainFile), "lib/main.dart did not exist", 100000);
		// Wait for up to 10 seconds for the content to match, as the file may be updated after creation.
		logger.info("Waiting for content match", LogCategory.CI);
		await waitForResult(() => {
			const contents = fs.readFileSync(mainFile);
			return contents.indexOf(expectedString) !== -1;
		}, undefined, 10000, false); // Don't throw on failure, as we have a better assert below that can include the contents.

		const contents = fs.readFileSync(mainFile);
		if (contents.indexOf(expectedString) === -1)
			assert.fail(`Did not find "${expectedString}'" in the sample file:\n\n${contents}`);
	});

	it("created a sample project", async () => {
		const sampleProjectFolder = fsPath(vs.workspace.workspaceFolders![1].uri);
		// const expectedString = "Flutter code sample for material.IconButton.1";
		const expectedString = "This sample shows an `IconButton` that";
		const mainFile = path.join(sampleProjectFolder, "lib", "main.dart");
		// Creating the sample may be a little slow, so allow up to 60 seconds for it.
		logger.info("Waiting for file to exist", LogCategory.CI);
		await waitForResult(() => fs.existsSync(mainFile), "lib/main.dart did not exist", 100000);
		// Wait for up to 10 seconds for the content to match, as the file may be updated after creation.
		logger.info("Waiting for content match", LogCategory.CI);
		await waitForResult(() => {
			const contents = fs.readFileSync(mainFile);
			return contents.indexOf(expectedString) !== -1;
		}, undefined, 10000, false); // Don't throw on failure, as we have a better assert below that can include the contents.

		const contents = fs.readFileSync(mainFile);
		if (contents.indexOf(expectedString) === -1)
			assert.fail(`Did not find "${expectedString}'" in the sample file (${mainFile}):\n\n${contents}`);
	});

	it("created a module project", async () => {
		const moduleProjectFolder = fsPath(vs.workspace.workspaceFolders![2].uri);
		const expectedString = "description: A new flutter module project";
		const pubspecFile = path.join(moduleProjectFolder, "pubspec.yaml");
		// Creating the project may be a little slow, so allow up to 60 seconds for it.
		logger.info("Waiting for file to exist", LogCategory.CI);
		await waitForResult(() => fs.existsSync(pubspecFile), "pubspec.yaml did not exist", 100000);
		// Wait for up to 10 seconds for the content to match, as the file may be updated after creation.
		logger.info("Waiting for content match", LogCategory.CI);
		await waitForResult(() => {
			const contents = fs.readFileSync(pubspecFile);
			return contents.indexOf(expectedString) !== -1;
		}, undefined, 10000, false); // Don't throw on failure, as we have a better assert below that can include the contents.

		const contents = fs.readFileSync(pubspecFile);
		if (contents.indexOf(expectedString) === -1)
			assert.fail(`Did not find "${expectedString}'" in the file (${pubspecFile}):\n\n${contents}`);
	});

	it("created a package project", async () => {
		const packageProjectFolder = fsPath(vs.workspace.workspaceFolders![3].uri);
		const expectedString = "description: A new Flutter package project";
		const pubspecFile = path.join(packageProjectFolder, "pubspec.yaml");
		// Creating the project may be a little slow, so allow up to 60 seconds for it.
		logger.info("Waiting for file to exist", LogCategory.CI);
		await waitForResult(() => fs.existsSync(pubspecFile), "pubspec.yaml did not exist", 100000);
		// Wait for up to 10 seconds for the content to match, as the file may be updated after creation.
		logger.info("Waiting for content match", LogCategory.CI);
		await waitForResult(() => {
			const contents = fs.readFileSync(pubspecFile);
			return contents.indexOf(expectedString) !== -1;
		}, undefined, 10000, false); // Don't throw on failure, as we have a better assert below that can include the contents.

		const contents = fs.readFileSync(pubspecFile);
		if (contents.indexOf(expectedString) === -1)
			assert.fail(`Did not find "${expectedString}'" in the file (${pubspecFile}):\n\n${contents}`);
	});

	it("created a plugin project", async () => {
		const pluginProjectFolder = fsPath(vs.workspace.workspaceFolders![4].uri);
		// Flutter below is lowercased in the created project; consequently, this test may fail if it gets fixed by Flutter in the future.
		const expectedString = "description: A new flutter plugin project";
		const pubspecFile = path.join(pluginProjectFolder, "pubspec.yaml");
		// Creating the project may be a little slow, so allow up to 60 seconds for it.
		logger.info("Waiting for file to exist", LogCategory.CI);
		await waitForResult(() => fs.existsSync(pubspecFile), "pubspec.yaml did not exist", 100000);
		// Wait for up to 10 seconds for the content to match, as the file may be updated after creation.
		logger.info("Waiting for content match", LogCategory.CI);
		await waitForResult(() => {
			const contents = fs.readFileSync(pubspecFile);
			return contents.indexOf(expectedString) !== -1;
		}, undefined, 10000, false); // Don't throw on failure, as we have a better assert below that can include the contents.

		const contents = fs.readFileSync(pubspecFile);
		if (contents.indexOf(expectedString) === -1)
			assert.fail(`Did not find "${expectedString}'" in the file (${pubspecFile}):\n\n${contents}`);
	});

	it("triggered Flutter mode", () => {
		const ext = vs.extensions.getExtension(dartCodeExtensionIdentifier);
		assert.ok(ext);
		assert.ok(ext.isActive);
		const api: InternalExtensionApi = ext.exports[internalApiSymbol];
		assert.equal(api.workspaceContext.hasAnyFlutterProjects, true);
	});
});
