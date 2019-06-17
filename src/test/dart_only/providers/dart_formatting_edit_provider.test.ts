import * as assert from "assert";
import * as vs from "vscode";
import { platformEol } from "../../../shared/constants";
import { activate, currentDoc, currentEditor, emptyExcludedFile, emptyFileInExcludedFolder, openFile, positionOf, setConfigForTest, setTestContent } from "../../helpers";

const formattingOptions: vs.FormattingOptions = { tabSize: 2, insertSpaces: true };

describe("dart_formatting_edit_provider", () => {

	beforeEach("activate", () => activate());

	const unformattedContent = `   main ( ) {     }${platformEol}`;
	const formattedContent = `main() {}${platformEol}`;

	async function formatDocument(expectResult = true): Promise<void> {
		const formatResult = await (vs.commands.executeCommand("vscode.executeFormatDocumentProvider", currentDoc().uri, formattingOptions) as Thenable<vs.TextEdit[]>);
		if (expectResult) {
			assert.ok(formatResult);
			assert.ok(formatResult.length);
			await currentEditor().edit((b) => formatResult.forEach((f) => b.replace(f.range, f.newText)));
		} else {
			assert.ok(!formatResult);
		}
	}

	async function formatOnType(searchText: string, character: string): Promise<void> {
		const position = positionOf(searchText);
		const formatResult = await (vs.commands.executeCommand("vscode.executeFormatOnTypeProvider", currentDoc().uri, position, character, formattingOptions) as Thenable<vs.TextEdit[]>);
		assert.ok(formatResult);
		assert.ok(formatResult.length);
		await currentEditor().edit((b) => formatResult.forEach((f) => b.replace(f.range, f.newText)));
	}

	it("formats the document", async () => {
		await setTestContent(unformattedContent);
		await formatDocument();
		assert.equal(currentDoc().getText(), formattedContent);
	});

	it("formats the document on save", async () => {
		await setConfigForTest("editor", "formatOnSave", true);
		await setTestContent(unformattedContent);
		await currentDoc().save();
		assert.equal(currentDoc().getText(), formattedContent);
	});

	it("does not format the document if disabled", async () => {
		// TODO: How can we handle this in LSP?
		// https://github.com/microsoft/vscode/issues/70314#issuecomment-502699605

		await setConfigForTest("editor", "formatOnSave", true);
		await setConfigForTest("dart", "enableSdkFormatter", false);
		await setTestContent(unformattedContent);
		await currentDoc().save();
		assert.equal(currentDoc().getText(), unformattedContent);
	});

	it("formats the document if re-enabled", async () => {
		await setConfigForTest("dart", "enableSdkFormatter", false);
		await setConfigForTest("editor", "formatOnSave", true);
		await setConfigForTest("dart", "enableSdkFormatter", true);
		await setTestContent(unformattedContent);
		await currentDoc().save();
		assert.equal(currentDoc().getText(), formattedContent);
	});

	it("formats the code when typing a }", async () => {
		// Currently we just format the whole doc on format as out formatter doesn't support ranges.
		await setTestContent(unformattedContent);
		await formatOnType("{ ^", "}");
		assert.equal(currentDoc().getText(), formattedContent);
	});

	it("does not format an excluded file", async () => {
		await openFile(emptyExcludedFile);
		await setTestContent(unformattedContent);
		await formatDocument(false);
		assert.equal(currentDoc().getText(), unformattedContent);
	});

	it("does not format a file in an excluded folder", async () => {
		await openFile(emptyFileInExcludedFolder);
		await setTestContent(unformattedContent);
		await formatDocument(false);
		assert.equal(currentDoc().getText(), unformattedContent);
	});
});
