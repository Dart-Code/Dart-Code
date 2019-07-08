import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import * as vs from "vscode";
import { dartCodeExtensionIdentifier } from "../../shared/constants";
import { internalApiSymbol } from "../../shared/symbols";
import { InternalExtensionApi } from "../../shared/vscode/interfaces";
import { fsPath } from "../../shared/vscode/utils";
import { sb, waitForResult } from "../helpers";
import sinon = require("sinon");

describe("flutter for web", () => {
	it("created a templated project", async () => {
		const executeCommand = sb.stub(vs.commands, "executeCommand").callThrough();
		const getPackagesCommand = executeCommand.withArgs("dart.getPackages", sinon.match.any).resolves();

		const sampleProjectFolder = fsPath(vs.workspace.workspaceFolders[0].uri);
		const expectedString = "import 'package:flutter_web";
		const mainFile = path.join(sampleProjectFolder, "web", "main.dart");

		// Creating the sample may be a little slow, so allow up to 60 seconds for it.
		await waitForResult(() => fs.existsSync(mainFile), "web/main.dart did not exist", 60000);

		// Wait for up to 10 seconds for the content to match, as the file may be updated after creation.
		await waitForResult(() => {
			const contents = fs.readFileSync(mainFile);
			return contents.indexOf(expectedString) !== -1;
		}, undefined, 10000, false); // Don't throw on failure, as we have a better assert below that can include the contents.

		const contents = fs.readFileSync(mainFile);
		if (contents.indexOf(expectedString) === -1)
			assert.fail(`Did not find "${expectedString}'" in the templated file:\n\n${contents}`);

		// Ensure we fetched packages too. This can be slow because the creation process may
		// take a long time to download and precompile the executables.
		await waitForResult(() => {
			return getPackagesCommand.calledOnce;
		}, "Get Packages was not called after creating the project", 40000);
	});

	it("triggered Flutter mode", () => {
		const ext = vs.extensions.getExtension(dartCodeExtensionIdentifier);
		assert.ok(ext);
		assert.ok(ext.isActive);
		const api: InternalExtensionApi = ext.exports[internalApiSymbol];
		assert.equal(api.workspaceContext.hasAnyFlutterProjects, true);
	});
});
