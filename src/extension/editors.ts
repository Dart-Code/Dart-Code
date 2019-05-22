import * as vs from "vscode";

export function isDartDocument(document: vs.TextDocument): boolean {
	return document && document.languageId === "dart";
}

export function getActiveDartEditor(): vs.TextEditor | undefined {
	const editor = vs.window.activeTextEditor;
	if (!editor || editor.document.languageId !== "dart")
		return undefined;
	return editor;
}
