import { strict as assert } from "assert";
import * as fs from "fs";
import * as path from "path";
import * as vs from "vscode";
import { dartCodeExtensionIdentifier } from "../../shared/constants";
import { internalApiSymbol } from "../../shared/symbols";
import { fsPath } from "../../shared/utils/fs";
import { InternalExtensionApi } from "../../shared/vscode/interfaces";
import { waitForResult } from "../helpers";

describe("dart", () => {
	it("created a templated project", async () => {
		const sampleProjectFolder = fsPath(vs.workspace.workspaceFolders![0].uri);
		const expectedString = "Hello world";
		const mainFile = path.join(sampleProjectFolder, "bin", "dart_create_template.dart");
		const packagesFile = path.join(sampleProjectFolder, ".dart_tool", "package_config.json");

		// Creating the sample may be a little slow, so allow up to 60 seconds for it.
		await waitForResult(() => fs.existsSync(mainFile), "bin/dart_create_template.dart did not exist", 60000);

		// Wait for up to 10 seconds for the content to match, as the file may be updated after creation.
		await waitForResult(() => {
			const contents = fs.readFileSync(mainFile);
			return contents.indexOf(expectedString) !== -1;
		}, undefined, 10000, false); // Don't throw on failure, as we have a better assert below that can include the contents.

		const contents = fs.readFileSync(mainFile);
		if (contents.indexOf(expectedString) === -1)
			assert.fail(`Did not find "${expectedString}'" in the templated file:\n\n${contents}`);

		// Ensure we fetched packages too.
		await waitForResult(() => fs.existsSync(packagesFile), ".dart_tool/package_config.json did not exist", 10000);
	});

	it("did not trigger Flutter mode", async () => {
		const ext = vs.extensions.getExtension(dartCodeExtensionIdentifier);
		assert.ok(ext);
		await waitForResult(() => ext.isActive, "Extension did not activate!", 10000);
		const api: InternalExtensionApi = ext.exports[internalApiSymbol];
		assert.equal(api.workspaceContext.hasAnyFlutterProjects, false);
	});
});
