import * as assert from "assert";
import * as path from "path";
import * as fs from "fs";
import * as vs from "vscode";
import { activate, helloWorldFolder, positionOf, rangeOf, ensureIsRange, waitFor } from "../../helpers";
import { OpenFileTracker } from "../../../src/analysis/open_file_tracker";

export const superFile = vs.Uri.file(path.join(helloWorldFolder.fsPath, "lib/go_to_super_method/super.dart"));
export const derivedFile = vs.Uri.file(path.join(helloWorldFolder.fsPath, "lib/go_to_super_method/derived.dart"));

describe("go_to_super_method", () => {
	before(async () => {
		await activate(derivedFile);
		await waitFor(() => !!OpenFileTracker.getOutlineFor(derivedFile));
	});

	it("navigates to base class within the same file", async () => {
		const e = rangeOf("|// blahE|");
		vs.window.activeTextEditor.selection = new vs.Selection(e.start, e.end);
		await vs.commands.executeCommand("dart.goToSuper");
		assert.deepStrictEqual(vs.window.activeTextEditor.document.uri, derivedFile);
		ensureIsRange(
			vs.window.activeTextEditor.selection,
			rangeOf("void |blah|()", new vs.Range(positionOf("^class D"), positionOf("^// blahD"))),
		);
	});
});
