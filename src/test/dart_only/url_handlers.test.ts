import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as sinon from "sinon";
import * as vs from "vscode";
import { FlutterCapabilities } from "../../extension/flutter/capabilities";
import { DartUriHandler } from "../../extension/uri_handlers/uri_handler";
import { FLUTTER_CREATE_PROJECT_TRIGGER_FILE } from "../../extension/utils";
import { getChildFolders } from "../../extension/utils/fs";
import { dartCodeExtensionIdentifier } from "../../shared/constants";
import { deleteDirectoryRecursive, sb } from "../helpers";

describe("URL handler", async () => {
	const urlHandler = new DartUriHandler(new FlutterCapabilities("1.0.0"));
	const tempPath = path.join(os.tmpdir(), dartCodeExtensionIdentifier, "flutter", "sample", "my.sample.id");
	beforeEach("clear out sample folder", () => deleteDirectoryRecursive(tempPath));
	afterEach("clear out sample folder", () => deleteDirectoryRecursive(tempPath));

	it("URL handler creates trigger file with sample ID in it", async () => {
		// Intercept executeCommand for openFolder so we don't spawn a new instance of Code!
		const executeCommand = sb.stub(vs.commands, "executeCommand").callThrough();
		const openFolderCommand = executeCommand.withArgs("vscode.openFolder", sinon.match.any).resolves();

		await urlHandler.handleUri(vs.Uri.parse(`vscode://Dart-Code.dart-code/flutter/sample/my.sample.id`));

		// Expect a single folder, which is out sample app.
		const childFolders = getChildFolders(tempPath);
		assert.equal(childFolders.length, 1);

		const projectFolder = childFolders[0];
		const triggerFile = path.join(projectFolder, FLUTTER_CREATE_PROJECT_TRIGGER_FILE);
		assert.ok(fs.existsSync(triggerFile));
		assert.equal(fs.readFileSync(triggerFile).toString(), "my.sample.id");
		assert.ok(openFolderCommand.calledOnce);
	});

	it("Rejects sample IDs that do not conform", async () => {
		const showErrorMessage = sb.stub(vs.window, "showErrorMessage");

		await urlHandler.handleUri(vs.Uri.parse(`vscode://Dart-Code.dart-code/flutter/sample/my fake/sample`));

		assert(showErrorMessage.calledOnce);
	});
});
