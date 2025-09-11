import * as vs from "vscode";
import { URI } from "vscode-uri";
import { uriComparisonString } from "../utils/fs";

export function isDartDocument(document: vs.TextDocument): boolean {
	return document && document.languageId === "dart";
}

export function getActiveDartEditor(): vs.TextEditor | undefined {
	const editor = vs.window.activeTextEditor;
	if (!editor || editor.document.languageId !== "dart")
		return undefined;
	return editor;
}

/// Gets the "active" file:// TextEditor, excluding any output: panes that
/// might be in the list.
export function getActiveRealFileEditor(): vs.TextEditor | undefined {
	let editor = vs.window.activeTextEditor;
	// It's possible the "active editor" is actually an Output pane, so
	// try falling back to a single visible (file-scheme) editor if there is one.
	if (editor?.document.uri.scheme !== "file") {
		const fileEditors = vs.window.visibleTextEditors.filter((e) => e.document.uri.scheme === "file");
		if (fileEditors.length === 1) {
			console.log(`Falling back from ${editor?.document.uri} to ${fileEditors[0].document.uri}`);
			editor = fileEditors[0];
		}
	}
	return editor?.document.uri.scheme === "file"
		? editor
		: undefined;
}

export function findVisibleEditor(uri: URI) {
	const uriKey = uriComparisonString(uri);
	return vs.window.visibleTextEditors.find((e) => uriComparisonString(e.document.uri) === uriKey);
}
