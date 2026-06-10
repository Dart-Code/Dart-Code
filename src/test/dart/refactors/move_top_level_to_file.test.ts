import * as path from "path";
import * as vs from "vscode";
import { fsPath } from "../../../shared/utils/fs";
import { activate, ensureFileContent, ensureTestContent, executeCodeAction, helloWorldFolder, privateApi, rangeOf, sb, setConfigForTest, setTestContent, tryDelete } from "../../helpers";

describe("move top level to file refactor", () => {

	beforeEach("activate", () => activate());

	describe("without interactive forms", () => {
		it("can move a simple class", async () => {
			await setConfigForTest("dart", "experimentalInteractiveForms", false);

			const newFile = vs.Uri.file(path.join(fsPath(helloWorldFolder), "lib/my_new_class.dart"));
			const showSaveDialog = sb.stub(vs.window, "showSaveDialog");
			showSaveDialog.resolves(newFile);

			await setTestContent(`
class A {}

class B {}

class C {}
		`);

			await executeCodeAction({ title: "Move 'B' to file" }, rangeOf("class |B|"));

			await ensureTestContent(`
class A {}

class C {}
		`);
			await ensureFileContent(newFile, `
class B {}
		`);
			tryDelete(newFile);
		});
	});

	describe("with interactive forms", () => {
		it("can move a simple class", async function () {
			if (!privateApi.dartCapabilities.supportsInteractiveForms)
				this.skip();

			await setConfigForTest("dart", "experimentalInteractiveForms", true);

			// Stub the quick-pick to select the "Create New File" option.
			sb.stub(vs.window, "showQuickPick").callsFake(async (items: vs.QuickPickItem[]) => {
				const expectedLabel = "Create New File";
				const selection = items.find((item) => item.label.includes(expectedLabel));
				if (!selection)
					throw new Error(`Did not find QuickPick entry ${expectedLabel} in: ${items.map((item) => `"${item.label}"`).join(", ")}`);
				return selection;
			});

			// Stub the save dialog to return a new URI.
			const newFile = vs.Uri.file(path.join(fsPath(helloWorldFolder), "lib/my_new_class.dart"));
			const showSaveDialog = sb.stub(vs.window, "showSaveDialog");
			showSaveDialog.resolves(newFile);

			await setTestContent(`
class A {}

class B {}

class C {}
		`);

			await executeCodeAction({ title: "Move 'B' to file" }, rangeOf("class |B|"));

			await ensureTestContent(`
class A {}

class C {}
		`);
			await ensureFileContent(newFile, `
class B {}
		`);
			tryDelete(newFile);
		});
	});
});
