import * as assert from "assert";
import * as vs from "vscode";
import { activate, doc, documentEol, editor, setTestContent } from "../../helpers";

describe("dart_formatting_edit_provider", () => {

	beforeEach("activate", () => activate());

	async function formatDocument(): Promise<void> {
		const formatResult = await (vs.commands.executeCommand("vscode.executeFormatDocumentProvider", doc.uri) as Thenable<vs.TextEdit[]>);
		assert.ok(formatResult);
		assert.ok(formatResult.length);
		await editor.edit((b) => formatResult.forEach((f) => b.replace(f.range, f.newText)));
	}

	it("formats the document", async () => {
		await setTestContent("   main ( ) {     }");
		await formatDocument();
		assert.equal(doc.getText(), `main() {}${documentEol}`);
	});
});
