import { strict as assert } from "assert";
import * as path from "path";
import * as vs from "vscode";
import { fsPath } from "../../../shared/utils/fs";
import { activate, currentEditor, ensureIsRange, extApi, helloWorldFolder, rangeOf, waitForResult } from "../../helpers";

const libFile = vs.Uri.file(path.join(fsPath(helloWorldFolder), "lib/go_to_augmentations/lib.dart"));
const augmentationFile = vs.Uri.file(path.join(fsPath(helloWorldFolder), "lib/go_to_augmentations/lib_augmentation.dart"));

describe("go_to_augmented", () => {
	beforeEach("activate and wait for outline", async () => {
		await activate(augmentationFile);
		await waitForResult(() => !!extApi.fileTracker.getOutlineFor(augmentationFile));
	});

	beforeEach("skip if not supported", function () {
		if (!extApi.isLsp || !extApi.dartCapabilities.supportsAugmentations)
			this.skip();
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
