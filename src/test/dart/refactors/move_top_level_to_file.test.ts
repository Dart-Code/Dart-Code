import * as path from "path";
import * as vs from "vscode";
import { fsPath } from "../../../shared/utils/fs";
import { activate, ensureFileContent, ensureTestContent, executeCodeAction, extApi, helloWorldFolder, rangeOf, sb, setTestContent, tryDelete } from "../../helpers";

describe("move top level to file refactor", () => {

	beforeEach("activate", () => activate());
	beforeEach("check capabilities", function () {
		if (!extApi.isLsp || !extApi.dartCapabilities.supportsMoveTopLevelToFile)
			this.skip();
	});

	it("can move a simple class", async () => {
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
