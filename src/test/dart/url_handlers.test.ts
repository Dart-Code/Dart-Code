import { strict as assert } from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as sinon from "sinon";
import * as vs from "vscode";
import { FlutterCapabilities } from "../../shared/capabilities/flutter";
import { dartCodeExtensionIdentifier, FLUTTER_CREATE_PROJECT_TRIGGER_FILE } from "../../shared/constants";
import { FlutterCreateTriggerData } from "../../shared/interfaces";
import { getChildFolders } from "../../shared/utils/fs";
import { DartUriHandler } from "../../shared/vscode/uri_handlers/uri_handler";
import { activate, privateApi, sb, tryDeleteDirectoryRecursive } from "../helpers";

describe("URL handler", async () => {
	const urlHandler = new DartUriHandler(new FlutterCapabilities("1.0.0"));
	const tempPath = path.join(os.tmpdir(), dartCodeExtensionIdentifier, "flutter", "sample", "my.sample.id");

	before(() => activate(null));
	beforeEach("clear out sample folder", () => tryDeleteDirectoryRecursive(tempPath));
	afterEach("clear out sample folder", () => tryDeleteDirectoryRecursive(tempPath));

	it("URL handler creates trigger file with sample ID in it", async () => {
		// Intercept executeCommand for openFolder so we don't spawn a new instance of Code!
		const executeCommand = sb.stub(vs.commands, "executeCommand").callThrough();
		const openFolderCommand = executeCommand.withArgs("vscode.openFolder", sinon.match.any).resolves();

		await urlHandler.handleUri(vs.Uri.parse(`vscode://Dart-Code.dart-code/flutter/sample/my.sample.id`));

		// Expect a single folder, which is out sample app.
		const childFolders = await getChildFolders(privateApi.logger, tempPath);
		assert.equal(childFolders.length, 1);

		const projectFolder = childFolders[0];
		assert.ok(openFolderCommand.calledOnce);

		const triggerFile = path.join(projectFolder, FLUTTER_CREATE_PROJECT_TRIGGER_FILE);
		assert.ok(fs.existsSync(triggerFile));

		const jsonString: string | undefined = fs.readFileSync(triggerFile).toString().trim();
		const json = jsonString ? JSON.parse(jsonString) as FlutterCreateTriggerData : undefined;

		assert.equal(json?.sample === "my.sample.id", true);
	});

	it("Rejects sample IDs that do not conform", async () => {
		const showErrorMessage = sb.stub(vs.window, "showErrorMessage");

		await urlHandler.handleUri(vs.Uri.parse(`vscode://Dart-Code.dart-code/flutter/sample/my fake/sample`));

		assert(showErrorMessage.calledOnce);
	});
});
