import { commands, ExtensionKind, extensions, Uri, workspace, WorkspaceFolder } from "vscode";
import { dartCodeExtensionIdentifier } from "../constants";
import { forceWindowsDriveLetterToUppercase } from "../utils";

const dartExtension = extensions.getExtension(dartCodeExtensionIdentifier);
// The extension kind is declared as Workspace, but VS Code will return UI in the
// case that there is no remote extension host.
export const isRunningLocally = dartExtension.extensionKind === ExtensionKind.UI;

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

export function getDartWorkspaceFolders(): WorkspaceFolder[] {
	if (!workspace.workspaceFolders)
		return [];
	return workspace.workspaceFolders.filter(isDartWorkspaceFolder);
}

export function isDartWorkspaceFolder(folder?: WorkspaceFolder): boolean {
	if (!folder || folder.uri.scheme !== "file")
		return false;

	// Currently we don't have good logic to know what's a Dart folder.
	// We could require a pubspec, but it's valid to just write scripts without them.
	// For now, nothing calls this that will do bad things if the folder isn't a Dart
	// project so we can review amend this in future if required.
	return true;
}
