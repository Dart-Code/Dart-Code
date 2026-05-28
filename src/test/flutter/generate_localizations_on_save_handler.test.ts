import { strict as assert } from "assert";
import * as path from "path";
import * as sinon from "sinon";
import * as vs from "vscode";
import { fsPath, getRandomInt } from "../../shared/utils/fs";
import { waitFor } from "../../shared/utils/promises";
import { activate, createTempTestFile, delay, flutterHelloWorldFolder, helloWorldFolder, openFile, sb, setConfigForTest, setTestContent } from "../helpers";

describe("generate localizations on save", () => {
	before("activate", () => activate());

	it("runs gen_l10n when saving a dirty arb file in a Flutter project", async () => {
		await setConfigForTest("dart", "flutterGenerateLocalizationsOnSave", "manual");
		const arbFile = createTempFile(flutterHelloWorldFolder, ".arb", "{}\n");
		const executeCommand = sb.stub(vs.commands, "executeCommand").callThrough();
		const genL10nCommand = executeCommand.withArgs("flutter.task.genl10n", sinon.match.any).resolves();

		const editor = await openFile(arbFile);
		await setTestContent('{"hello": "Hello"}\n');
		await editor.document.save();

		await waitFor(() => genL10nCommand.calledOnce);
		assert.equal(genL10nCommand.firstCall.args[0], "flutter.task.genl10n");
		assert.equal(fsPath(genL10nCommand.firstCall.args[1][0] as vs.Uri), fsPath(arbFile));
	});

	it("does not run gen_l10n when the setting is never", async () => {
		await setConfigForTest("dart", "flutterGenerateLocalizationsOnSave", "never");
		const arbFile = createTempFile(flutterHelloWorldFolder, ".arb", "{}\n");
		const executeCommand = sb.stub(vs.commands, "executeCommand").callThrough();
		const genL10nCommand = executeCommand.withArgs("flutter.task.genl10n", sinon.match.any).resolves();

		const editor = await openFile(arbFile);
		await setTestContent('{"hello": "Hello"}\n');
		await editor.document.save();

		await delay(300); // Wait some time to allow for the command to run if it would.
		assert.ok(genL10nCommand.notCalled);
	});

	it("does not run gen_l10n when saving a non-arb file in a Flutter project", async () => {
		await setConfigForTest("dart", "flutterGenerateLocalizationsOnSave", "all");
		const textFile = createTempFile(flutterHelloWorldFolder, ".txt", "before\n");
		const executeCommand = sb.stub(vs.commands, "executeCommand").callThrough();
		const genL10nCommand = executeCommand.withArgs("flutter.task.genl10n", sinon.match.any).resolves();

		const editor = await openFile(textFile);
		await setTestContent("after\n");
		await editor.document.save();

		await delay(300); // Wait some time to allow for the command to run if it would.
		assert.ok(genL10nCommand.notCalled);
	});

	it("does not run gen_l10n when saving an arb file outside a Flutter project", async () => {
		await setConfigForTest("dart", "flutterGenerateLocalizationsOnSave", "all");
		const arbFile = createTempFile(helloWorldFolder, ".arb", "{}\n");
		const executeCommand = sb.stub(vs.commands, "executeCommand").callThrough();
		const genL10nCommand = executeCommand.withArgs("flutter.task.genl10n", sinon.match.any).resolves();

		const editor = await openFile(arbFile);
		await setTestContent('{"hello": "Hello"}\n');
		await editor.document.save();

		await delay(300); // Wait some time to allow for the command to run if it would.
		assert.ok(genL10nCommand.notCalled);
	});
});

function createTempFile(projectFolder: vs.Uri, extension: string, content: string): vs.Uri {
	const filePath = path.join(fsPath(projectFolder), `gen_localizations_${getRandomInt(0, 100000)}${extension}`);
	createTempTestFile(filePath, content);
	return vs.Uri.file(filePath);
}
