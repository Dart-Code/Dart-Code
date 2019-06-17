import { commands, Uri } from "vscode";
import { forceWindowsDriveLetterToUppercase } from "../utils";

export function fsPath(uri: Uri | string) {
	// tslint:disable-next-line:disallow-fspath
	return forceWindowsDriveLetterToUppercase(uri instanceof Uri ? uri.fsPath : uri);
}

export function openInBrowser(url: string) {
	// Don't use vs.env.openExternal unless
	// https://github.com/Microsoft/vscode/issues/69608
	// is fixed, as it complicates testing.
	commands.executeCommand("vscode.open", Uri.parse(url));
}
