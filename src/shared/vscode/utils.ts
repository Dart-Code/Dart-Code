import { Uri } from "vscode";
import { config } from "../../extension/config";
import { forceWindowsDriveLetterToUppercase } from "../utils";

export function fsPath(uri: Uri | string) {
	if (!config.normalizeWindowsDriveLetters)
		return uri instanceof Uri ? uri.fsPath : uri; // tslint:disable-line:disallow-fspath

	// tslint:disable-next-line:disallow-fspath
	return forceWindowsDriveLetterToUppercase(uri instanceof Uri ? uri.fsPath : uri);
}
