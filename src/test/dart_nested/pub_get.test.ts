import { strict as assert } from "assert";
import * as sinon from "sinon";
import * as vs from "vscode";
import { fsPath } from "../../shared/utils/fs";
import { activate, dartNested1Folder, dartNested1PubspecFile, dartNested2Folder, dartNestedFolder, openFile, sb, setConfigForTest, setTestContent, waitForResult } from "../helpers";

describe("pub get", () => {

	beforeEach("activate", () => activate());

	const folderTop = fsPath(dartNestedFolder);
	const folderMiddle = fsPath(dartNested1Folder);
	const folderBottom = fsPath(dartNested2Folder);

	async function modifyPubspecAndCollectPubGetPaths() {
		const executeCommand = sb.stub(vs.commands, "executeCommand").callThrough();
		const getPackagesCommand = executeCommand.withArgs("dart.getPackages", sinon.match.any).resolves();

		const editor = await openFile(dartNested1PubspecFile);
		const doc = editor.document;
		await setTestContent(doc.getText() + " # test");
		await doc.save();

		// Allow a short time for the command to be called because this is now a
		// file system watcher.
		await waitForResult(() => getPackagesCommand.called);
		const paths = (getPackagesCommand.args[0][1] as vs.Uri[]).map((u) => fsPath(u));
		return paths;
	}

	it("runs pub get only for main project by default", async () => {
		const paths = await modifyPubspecAndCollectPubGetPaths();
		assert.deepStrictEqual(
			paths,
			[folderMiddle],
		);
	});

	it("runs pub get for parent project if set to 'above'", async () => {
		await setConfigForTest("dart", "runPubGetOnNestedProjects", "above");
		const paths = await modifyPubspecAndCollectPubGetPaths();
		assert.deepStrictEqual(
			paths,
			[folderMiddle, folderTop],
		);
	});

	it("runs pub get for child project if set to 'below'", async () => {
		await setConfigForTest("dart", "runPubGetOnNestedProjects", "below");
		const paths = await modifyPubspecAndCollectPubGetPaths();
		assert.deepStrictEqual(
			paths,
			[folderMiddle, folderBottom],
		);
	});

	it("runs pub get for all projects if set to 'both'", async () => {
		await setConfigForTest("dart", "runPubGetOnNestedProjects", "both");
		const paths = await modifyPubspecAndCollectPubGetPaths();
		assert.deepStrictEqual(
			paths,
			[folderMiddle, folderTop, folderBottom],
		);
	});
});
