import { strict as assert } from "assert";
import * as fs from "fs";
import * as path from "path";
import * as vs from "vscode";
import { fsPath, mkDirRecursive } from "../../../shared/utils/fs";
import { activate, currentEditor, ensureIsRange, helloWorldFolder, helloWorldPubspec, openFile, privateApi, rangeOf, waitForResult } from "../../helpers";

const libFile = vs.Uri.file(path.join(fsPath(helloWorldFolder), "lib/go_to_augmentations/lib.dart"));
const augmentationFile = vs.Uri.file(path.join(fsPath(helloWorldFolder), "lib/go_to_augmentations/lib_augmentation.dart"));

// These files are written at test time because they're only valid for some SDK versions.
const libContent = `
import augment 'lib_augmentation.dart';

class A {}
`;
const augmentationContent = `
augment library 'lib.dart';

augment class A {}
`;

describe("go to", () => {
	beforeEach("activate", async () => {
		await activate();
	});

	beforeEach("skip if not supported", function () {
		if (!privateApi.dartCapabilities.supportsAugmentations)
			this.skip();
	});

	beforeEach("write files", async () => {
		fs.writeFileSync(fsPath(helloWorldPubspec), fs.readFileSync(fsPath(helloWorldPubspec)).toString().replace("sdk: '>=2.12.0 <4.0.0'", "sdk: '>=3.6.0-0 <4.0.0'"));
		mkDirRecursive(path.dirname(fsPath(libFile)));
		fs.writeFileSync(fsPath(libFile), libContent);
		fs.writeFileSync(fsPath(augmentationFile), augmentationContent);

		// Modifying pubspec will trigger analysis.
		await privateApi.nextAnalysis();
	});

	describe("augmentation", () => {
		beforeEach("wait for outline", async () => {
			await openFile(libFile);
			await waitForResult(() => !!privateApi.fileTracker.getOutlineFor(libFile));
		});

		it("navigates to augmented class", async () => {
			let editor = currentEditor();
			const e = rangeOf("class |A|");
			editor.selection = new vs.Selection(e.start, e.end);

			await vs.commands.executeCommand("dart.goToAugmentation");

			editor = currentEditor();
			assert.equal(fsPath(editor.document.uri), fsPath(augmentationFile));
			ensureIsRange(
				editor.selection,
				rangeOf("augment class |A| {}"),
			);
		});

		it("navigates to augmented class that was open in another column", async () => {
			// Open target file in another column with another file over it.
			await openFile(augmentationFile, vs.ViewColumn.Two);
			await openFile(helloWorldPubspec, vs.ViewColumn.Two);
			await openFile(libFile, vs.ViewColumn.One);


			let editor = currentEditor();
			const e = rangeOf("class |A|");
			editor.selection = new vs.Selection(e.start, e.end);
			await vs.commands.executeCommand("dart.goToAugmentation");

			// Check correct editor has focus.
			editor = currentEditor();
			assert.equal(fsPath(editor.document.uri), fsPath(augmentationFile));
			ensureIsRange(
				editor.selection,
				rangeOf("augment class |A| {}"),
			);

			// Check active file in each group is as expected.
			const activeFiles = vs.window.tabGroups.all
				.map((group) => group.tabs.find((tab) => tab.isActive && tab.input instanceof vs.TabInputText))
				.map((tab) => (tab?.input as vs.TabInputText)?.uri?.toString());
			assert.deepStrictEqual(activeFiles,
				[
					libFile.toString(),
					augmentationFile.toString(),
				],
			);
		});
	});

	describe("augmented", () => {
		beforeEach("wait for outline", async () => {
			await openFile(augmentationFile);
			await waitForResult(() => !!privateApi.fileTracker.getOutlineFor(libFile));
		});

		it("navigates to augmented class", async () => {
			let editor = currentEditor();
			const e = rangeOf("augment class |A|");
			editor.selection = new vs.Selection(e.start, e.end);

			await vs.commands.executeCommand("dart.goToAugmented");

			editor = currentEditor();
			assert.equal(fsPath(editor.document.uri), fsPath(libFile));
			ensureIsRange(
				editor.selection,
				rangeOf("class |A| {}"),
			);
		});
	});
});
