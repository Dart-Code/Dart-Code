import * as vs from "vscode";

export function hasActiveDartEditor(): boolean {
	if (!vs.window.activeTextEditor)
		return false;

	return vs.window.activeTextEditor.document.languageId === "dart";
}
