import * as assert from "assert";
import * as path from "path";
import * as fs from "fs";
import * as vs from "vscode";

const ext = vs.extensions.getExtension("Dart-Code.dart-code");
const helloWorldFolder = vs.Uri.file(path.join(ext.extensionPath, "test/test_projects/hello_world"));
const emptyFile = vs.Uri.file(path.join(helloWorldFolder.fsPath, "lib/empty.dart"));

describe("dart_hover_provider", () => {
	let doc: vs.TextDocument;
	let editor: vs.TextEditor;

	before(async () => ext.activate());

	async function setTestContent(content: string): Promise<boolean> {
		doc = await vs.workspace.openTextDocument(emptyFile);
		editor = await vs.window.showTextDocument(doc);
		const all = new vs.Range(
			doc.positionAt(0),
			doc.positionAt(doc.getText().length),
		);
		return editor.edit((eb) => eb.replace(all, content));
	}

	async function getHoversAt(searchText: string): Promise<Array<{ displayText: string, documentation?: string, range: vs.Range }>> {
		const caretOffset = searchText.indexOf("^");
		assert.notEqual(caretOffset, -1, `Couldn't find a ^ in search text (${searchText})`);
		const matchedTextIndex = doc.getText().indexOf(searchText.replace("^", ""));
		assert.notEqual(matchedTextIndex, -1, `Couldn't find string ${searchText.replace("^", "")} in the document to send hovers for`);

		const position = doc.positionAt(matchedTextIndex + caretOffset);
		const hoverResult = await (vs.commands.executeCommand("vscode.executeHoverProvider", doc.uri, position) as Thenable<vs.Hover[]>);

		// Our hovers are aways in the form:
		// [{ language: "dart", value: data.displayString }, data.documentation || undefined],
		if (hoverResult == null || hoverResult.length === 0)
			return [];

		return hoverResult.map((h) => {
			const displayText = ((h.contents[0] as any).value as string).trim();
			const docs = ((h.contents[1] as any).value as string).trim();
			assert.equal(displayText.substr(0, 7), "```dart");
			assert.equal(displayText.substr(-3), "```");
			return {
				displayText: displayText.substring(7, displayText.length - 3).trim(),
				documentation: docs,
				range: h.range,
			};
		});
	}

	function rangeOf(searchText: string): vs.Range {
		const startOffset = searchText.indexOf("|");
		assert.notEqual(startOffset, -1, `Couldn't find a | in search text (${searchText})`);
		const endOffset = searchText.lastIndexOf("|");
		assert.notEqual(endOffset, -1, `Couldn't find a second | in search text (${searchText})`);

		const matchedTextIndex = doc.getText().indexOf(searchText.replace(/\|/g, ""));
		assert.notEqual(matchedTextIndex, -1, `Couldn't find string ${searchText.replace(/\|/g, "")} in the document to expect range for`);

		return new vs.Range(
			doc.positionAt(matchedTextIndex + startOffset),
			doc.positionAt(matchedTextIndex + endOffset - 1),
		);
	}

	it("does not return hovers for blank areas of the document", async () => {
		await setTestContent(" \n \n");
		const hovers = await getHoversAt("\n^");
		assert.equal(hovers.length, 0);
	});

	it("returns a hover for a function call", async () => {
		await setTestContent("main() { print('Hello, world!'); }");
		const hovers = await getHoversAt("pri^nt");
		assert.equal(hovers.length, 1);
	});

	it("returns expected information for a class", async () => {
		await setTestContent(`
		/// A Person.
		class Person {}
		`);
		const hovers = await getHoversAt("class Pe^rson");
		assert.equal(hovers.length, 1);
		const hover = hovers[0];
		assert.equal(hover.displayText, "class Person");
		assert.equal(hover.documentation, "A Person.");
		const expectedRange = rangeOf("class |Person|");
		assert.equal(hover.range.start.line, expectedRange.start.line);
		assert.equal(hover.range.start.character, expectedRange.start.character);
		assert.equal(hover.range.end.line, expectedRange.end.line);
		assert.equal(hover.range.end.character, expectedRange.end.character);
	});
});
