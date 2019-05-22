import * as assert from "assert";
import * as vs from "vscode";
import { activate, currentDoc, ensureTestContent, extApi, positionOf, setTestContent } from "../../helpers";

describe("rename_provider", () => {

	beforeEach("activate", () => activate());

	it("renames all exact references but not other items with same name", async () => {
		const doc = currentDoc();
		await setTestContent(`
			class Danny {
				static int myField = 1;
			}
			class Other {
				static int Danny = 2;
			}
			var a = new Danny();
			print(Danny.myField);
		`);
		const renameResult = await (vs.commands.executeCommand("vscode.executeDocumentRenameProvider", doc.uri, positionOf("D^anny"), "NewDanny") as Thenable<vs.WorkspaceEdit>);
		await vs.workspace.applyEdit(renameResult);
		await ensureTestContent(`
			class NewDanny {
				static int myField = 1;
			}
			class Other {
				static int Danny = 2;
			}
			var a = new NewDanny();
			print(NewDanny.myField);
		`);
	});

	it("renames alias on the import keyword", async () => {
		const doc = currentDoc();
		await setTestContent(`
			import "dart:async" as async;
		`);

		const renamePrep = await extApi.renameProvider.prepareRename(doc, positionOf("i^mport"), undefined);
		assert.equal(renamePrep.placeholder, "async");
		const renameResult = await extApi.renameProvider.provideRenameEdits(doc, renamePrep.range.start, "async2", undefined);
		await vs.workspace.applyEdit(renameResult);
		await ensureTestContent(`
			import "dart:async" as async2;
		`);
	});

	it("renames the class on the class keyword", async () => {
		const doc = currentDoc();
		await setTestContent(`
			class Danny {}
		`);

		const renamePrep = await extApi.renameProvider.prepareRename(doc, positionOf("D^anny"), undefined);
		assert.equal(renamePrep.placeholder, "Danny");
		const renameResult = await extApi.renameProvider.provideRenameEdits(doc, renamePrep.range.start, "Danny2", undefined);
		await vs.workspace.applyEdit(renameResult);
		await ensureTestContent(`
			class Danny2 {}
		`);
	});
});
