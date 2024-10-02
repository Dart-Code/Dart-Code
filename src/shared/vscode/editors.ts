import { window } from "vscode";
import { URI } from "vscode-uri";
import { uriComparisonString } from "../utils/fs";

export function findVisibleEditor(uri: URI) {
	const uriKey = uriComparisonString(uri);
	return window.visibleTextEditors.find((e) => uriComparisonString(e.document.uri) === uriKey);
}
