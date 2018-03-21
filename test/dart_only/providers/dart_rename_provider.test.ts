import * as assert from "assert";
import * as path from "path";
import * as fs from "fs";
import * as vs from "vscode";
import { activate, doc, getPositionOf, setTestContent, editor } from "../../helpers";

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
		const renameResult = await (vs.commands.executeCommand("vscode.executeDocumentRenameProvider", doc.uri, getPositionOf("D^anny"), "NewDanny") as Thenable<vs.WorkspaceEdit>);
		await vs.workspace.applyEdit(renameResult);
		assert.equal(doc.getText(), `
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
});
