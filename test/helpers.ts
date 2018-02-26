import * as assert from "assert";
import * as path from "path";
import * as fs from "fs";
import * as vs from "vscode";

const ext = vs.extensions.getExtension("Dart-Code.dart-code");
export const helloWorldFolder = vs.Uri.file(path.join(ext.extensionPath, "test/test_projects/hello_world"));
export const emptyFile = vs.Uri.file(path.join(helloWorldFolder.fsPath, "lib/empty.dart"));
export const everythingFile = vs.Uri.file(path.join(helloWorldFolder.fsPath, "lib/everything.dart"));

export let doc: vs.TextDocument;
export let editor: vs.TextEditor;

export async function activate(file: vs.Uri = emptyFile): Promise<void> {
	await ext.activate();
	doc = await vs.workspace.openTextDocument(file);
	editor = await vs.window.showTextDocument(doc);
}

export async function setTestContent(content: string): Promise<boolean> {
	const all = new vs.Range(
		doc.positionAt(0),
		doc.positionAt(doc.getText().length),
	);
	return editor.edit((eb) => eb.replace(all, content));
}

export function getPositionOf(searchText: string): vs.Position {
	const caretOffset = searchText.indexOf("^");
	assert.notEqual(caretOffset, -1, `Couldn't find a ^ in search text (${searchText})`);
	const matchedTextIndex = doc.getText().indexOf(searchText.replace("^", ""));
	assert.notEqual(matchedTextIndex, -1, `Couldn't find string ${searchText.replace("^", "")} in the document to get position of`);

	return doc.positionAt(matchedTextIndex + caretOffset);
}

export function rangeOf(searchText: string): vs.Range {
	const startOffset = searchText.indexOf("|");
	assert.notEqual(startOffset, -1, `Couldn't find a | in search text (${searchText})`);
	const endOffset = searchText.lastIndexOf("|");
	assert.notEqual(endOffset, -1, `Couldn't find a second | in search text (${searchText})`);

	const matchedTextIndex = doc.getText().indexOf(searchText.replace(/\|/g, ""));
	assert.notEqual(matchedTextIndex, -1, `Couldn't find string ${searchText.replace(/\|/g, "")} in the document to get range of`);

	return new vs.Range(
		doc.positionAt(matchedTextIndex + startOffset),
		doc.positionAt(matchedTextIndex + endOffset - 1),
	);
}
