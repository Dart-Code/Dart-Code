import * as vs from "vscode";

export function hasActiveDartEditor(): boolean {
	return isDartEditor(vs.window.activeTextEditor);
}

export function isDartEditor(editor: vs.TextEditor): boolean {
	return editor && isDartDocument(editor.document);
}

export function isDartDocument(document: vs.TextDocument): boolean {
	return document && document.languageId === "dart";
}
