import * as vs from "vscode";
import { activate, currentDoc, ensureTestContent, positionOf, setTestContent } from "../../helpers";

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
			void f() {
				print(Danny.myField);
			}
		`);
		const renameResult = await vs.commands.executeCommand<vs.WorkspaceEdit>("vscode.executeDocumentRenameProvider", doc.uri, positionOf("D^anny"), "NewDanny");
		await vs.workspace.applyEdit(renameResult);
		await ensureTestContent(`
			class NewDanny {
				static int myField = 1;
			}
			class Other {
				static int Danny = 2;
			}
			var a = new NewDanny();
			void f() {
				print(NewDanny.myField);
			}
		`);
	});
});
