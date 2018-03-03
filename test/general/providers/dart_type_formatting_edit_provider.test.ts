import * as assert from "assert";
import * as path from "path";
import * as fs from "fs";
import * as vs from "vscode";
import { activate, doc, setTestContent, editor, getPositionOf, eol } from "../../helpers";

describe("dart_type_formatting_edit_provider", () => {

	before(async () => activate());

	async function formatAtLocation(searchText: string, character: string): Promise<void> {
		const position = getPositionOf(searchText);
		const formatResult = await (vs.commands.executeCommand("vscode.executeFormatOnTypeProvider", doc.uri, position, character) as Thenable<vs.TextEdit[]>);
		assert.ok(formatResult);
		assert.ok(formatResult.length);
		await editor.edit((b) => formatResult.forEach((f) => b.replace(f.range, f.newText)));
	}

	it("formats the code", async () => {
		// Currently we just format the whole doc on format as out formatter doesn't support ranges.
		await setTestContent("   main ( ) { }");
		await formatAtLocation("{ ^", "}");
		assert.equal(doc.getText(), `main() {}${eol}`);
	});
});
