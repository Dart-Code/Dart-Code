import * as assert from "assert";
import * as path from "path";
import * as fs from "fs";
import * as vs from "vscode";
import { activate, doc, positionOf, setTestContent, editor, ensureTestContent } from "../../helpers";

describe.only("rename_provider", () => {

	before(() => activate());

	it("renames all exact references but not other items with same name", async () => {
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

	// https://github.com/Microsoft/vscode/issues/7340#issuecomment-383642803
	it.skip("renames alias on the import keyword", async () => {
		await setTestContent(`
			import "dart:async" as async;
		`);

		const renameResult = await (vs.commands.executeCommand("vscode.executeDocumentRenameProvider", doc.uri, positionOf("i^mport"), "async2") as Thenable<vs.WorkspaceEdit>);
		await vs.workspace.applyEdit(renameResult);
		await ensureTestContent(`
			import "dart:async" as async2;
		`);
	});

	// https://github.com/Microsoft/vscode/issues/7340#issuecomment-383642803
	it.skip("renames the class on the class keyword", async () => {
		await setTestContent(`
			class Danny {}
		`);

		const renameResult = await (vs.commands.executeCommand("vscode.executeDocumentRenameProvider", doc.uri, positionOf("D^anny"), "Danny2") as Thenable<vs.WorkspaceEdit>);
		await vs.workspace.applyEdit(renameResult);
		await ensureTestContent(`
			class Danny2 {}
		`);
	});
});
