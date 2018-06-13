import * as assert from "assert";
import * as path from "path";
import * as vs from "vscode";
import { OpenFileTracker } from "../../../src/analysis/open_file_tracker";
import { fsPath } from "../../../src/utils";
import { activate, ensureIsRange, helloWorldFolder, positionOf, rangeOf, waitFor } from "../../helpers";

const superFile = vs.Uri.file(path.join(fsPath(helloWorldFolder), "lib/go_to_super_method/super.dart"));
const derivedFile = vs.Uri.file(path.join(fsPath(helloWorldFolder), "lib/go_to_super_method/derived.dart"));

describe("go_to_super_method", () => {
	beforeEach("activate and wait for outline", async () => {
		await activate(derivedFile);
		await waitFor(() => !!OpenFileTracker.getOutlineFor(derivedFile));
	});

	it("navigates to base class within the same file", async () => {
		const e = rangeOf("|// blahE|");
		vs.window.activeTextEditor.selection = new vs.Selection(e.start, e.end);
		await vs.commands.executeCommand("dart.goToSuper");
		assert.equal(fsPath(vs.window.activeTextEditor.document.uri), fsPath(derivedFile));
		ensureIsRange(
			vs.window.activeTextEditor.selection,
			rangeOf("void |blah|()", new vs.Range(positionOf("^class D"), positionOf("^// blahD"))),
		);
	});

	it("skips over classes with no implementation", async () => {
		const d = rangeOf("|// blahD|");
		vs.window.activeTextEditor.selection = new vs.Selection(d.start, d.end);
		await vs.commands.executeCommand("dart.goToSuper");
		assert.equal(fsPath(vs.window.activeTextEditor.document.uri), fsPath(derivedFile));
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
		assert.equal(fsPath(vs.window.activeTextEditor.document.uri), fsPath(superFile));
		ensureIsRange(
			vs.window.activeTextEditor.selection,
			rangeOf("void |blah|()", new vs.Range(positionOf("^class A"), positionOf("^// blahA"))),
		);
	});
});
