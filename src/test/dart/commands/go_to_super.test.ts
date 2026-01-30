import { strict as assert } from "assert";
import * as path from "path";
import * as vs from "vscode";
import { fsPath } from "../../../shared/utils/fs";
import { activate, currentDoc, currentEditor, ensureRangeIsPosition, helloWorldFolder, positionOf, privateApi, rangeOf, waitForResult } from "../../helpers";

const superFile = vs.Uri.file(path.join(fsPath(helloWorldFolder), "lib/go_to_super/super.dart"));
const derivedFile = vs.Uri.file(path.join(fsPath(helloWorldFolder), "lib/go_to_super/derived.dart"));

describe("go_to_super", () => {
	beforeEach("activate and wait for outline", async () => {
		await activate(derivedFile);
		await waitForResult(() => !!privateApi.fileTracker.getOutlineFor(derivedFile));
	});

	it("navigates to base class within the same file", async () => {
		const editor = currentEditor();
		const e = rangeOf("|// blahE|");
		editor.selection = new vs.Selection(e.start, e.end);
		await vs.commands.executeCommand("dart.goToSuper");
		assert.equal(fsPath(editor.document.uri), fsPath(derivedFile));
		ensureRangeIsPosition(
			editor.selection,
			rangeOf("void |blah|()", undefined, new vs.Range(positionOf("^class D"), positionOf("^// blahD"))).start,
		);
	});

	it("skips over classes with no implementation", async () => {
		const editor = currentEditor();
		const d = rangeOf("|// blahD|");
		editor.selection = new vs.Selection(d.start, d.end);
		await vs.commands.executeCommand("dart.goToSuper");
		assert.equal(fsPath(editor.document.uri), fsPath(derivedFile));
		// Check we went to B and not C (because B doesn't have an implementation).
		ensureRangeIsPosition(
			editor.selection,
			rangeOf("void |blah|()", undefined, new vs.Range(positionOf("^class B"), positionOf("^// blahB"))).start,
		);
	});

	it("can navigate to other files", async () => {
		const b = rangeOf("|// blahB|");
		currentEditor().selection = new vs.Selection(b.start, b.end);
		await vs.commands.executeCommand("dart.goToSuper");
		// Check we went to the super file.
		assert.equal(fsPath(currentDoc().uri), fsPath(superFile));
		ensureRangeIsPosition(
			currentEditor().selection,
			rangeOf("void |blah|()", undefined, new vs.Range(positionOf("^class A"), positionOf("^// blahA"))).start,
		);
	});
});
