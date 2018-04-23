import * as assert from "assert";
import * as path from "path";
import * as fs from "fs";
import * as vs from "vscode";
import { activate, doc, positionOf, setTestContent, editor, ensureTestContent } from "../../helpers";

describe("rename_provider", () => {

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

	it("rejects a rename on the import keyword", async () => {
		await setTestContent(`
			import "dart:async" as async;
		`);

		try {
			await vs.commands.executeCommand("vscode.executeDocumentRenameProvider", doc.uri, positionOf("i^mport"), "import2");
			assert.fail("<error>", "<no error", "Rename did not throw as expected");
		} catch (e) {
			assert.equal(e.message, "This rename is not supported.");
		}
	});

	it("rejects a rename on the class keyword", async () => {
		await setTestContent(`
			class Danny {}
		`);

		try {
			await vs.commands.executeCommand("vscode.executeDocumentRenameProvider", doc.uri, positionOf("c^lass"), "class2");
			assert.fail("<error>", "<no error", "Rename did not throw as expected");
		} catch (e) {
			assert.equal(e.message, "This rename is not supported.");
		}
	});
});
