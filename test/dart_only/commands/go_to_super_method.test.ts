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
		assert.equal(vs.window.activeTextEditor.document.uri.fsPath, derivedFile.fsPath);
		ensureIsRange(
			vs.window.activeTextEditor.selection,
			rangeOf("void |blah|()", new vs.Range(positionOf("^class D"), positionOf("^// blahD"))),
		);
	});

	it("skips over classes with no implementation", async () => {
		const d = rangeOf("|// blahD|");
		vs.window.activeTextEditor.selection = new vs.Selection(d.start, d.end);
		await vs.commands.executeCommand("dart.goToSuper");
		assert.equal(vs.window.activeTextEditor.document.uri.fsPath, derivedFile.fsPath);
		// Check we went to B and not C (because B doesn't have an implementation).
		ensureIsRange(
			vs.window.activeTextEditor.selection,
			rangeOf("void |blah|()", new vs.Range(positionOf("^class B"), positionOf("^// blahB"))),
		);
	});

	it("can navigate to other files", async () => {
		const b = rangeOf("|// blahB|");
		vs.window.activeTextEditor.selection = new vs.Selection(b.start, b.end);
		await vs.commands.executeCommand("dart.goToSuper");
		// Check we went to the super file.
		assert.equal(vs.window.activeTextEditor.document.uri.fsPath, superFile.fsPath);
		ensureIsRange(
			vs.window.activeTextEditor.selection,
			rangeOf("void |blah|()", new vs.Range(positionOf("^class A"), positionOf("^// blahA"))),
		);
	});
});
