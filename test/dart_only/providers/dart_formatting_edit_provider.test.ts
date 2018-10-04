import * as assert from "assert";
import * as vs from "vscode";
import { activate, currentDoc, currentEditor, documentEol, positionOf, setTestContent } from "../../helpers";

describe("dart_formatting_edit_provider", () => {

	beforeEach("activate", () => activate());

	async function formatDocument(): Promise<void> {
		const formatResult = await (vs.commands.executeCommand("vscode.executeFormatDocumentProvider", currentDoc().uri) as Thenable<vs.TextEdit[]>);
		assert.ok(formatResult);
		assert.ok(formatResult.length);
		await currentEditor().edit((b) => formatResult.forEach((f) => b.replace(f.range, f.newText)));
	}

	async function formatOnType(searchText: string, character: string): Promise<void> {
		const position = positionOf(searchText);
		const formatResult = await (vs.commands.executeCommand("vscode.executeFormatOnTypeProvider", currentDoc().uri, position, character) as Thenable<vs.TextEdit[]>);
		assert.ok(formatResult);
		assert.ok(formatResult.length);
		await currentEditor().edit((b) => formatResult.forEach((f) => b.replace(f.range, f.newText)));
	}

	it("formats the document", async () => {
		await setTestContent("   main ( ) {     }");
		await formatDocument();
		assert.equal(currentDoc().getText(), `main() {}${documentEol}`);
	});

	it("formats the code when typing a }", async () => {
		// Currently we just format the whole doc on format as out formatter doesn't support ranges.
		await setTestContent("   main ( ) { }");
		await formatOnType("{ ^", "}");
		assert.equal(currentDoc().getText(), `main() {}${documentEol}`);
	});
});
