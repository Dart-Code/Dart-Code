import * as path from "path";
import { Uri, workspace } from "vscode";
import { hasPackageMapFile, hasPubspec } from "../utils/fs";

export function locateBestProjectRoot(folder: string, allowOutsideWorkspace = false): string | undefined {
	// TODO(dantup): The term "Project" is a bit ambigious, and some places that call here really want "pub roots" (eg. the package, or if it's
	//  part of a Pub Workspace, the pub workspace root), and some want the packages (eg. the things that have a pubspec.yaml and a name).
	//  Perhaps consider a GLOSSARY.md and define terms to use consistently (and match don't use "Project" at all?).

	// TODO(dantup): Review places where allowOutsideWorkspace is effectively false, because opening sub-folders
	//  of Pub Workspaces is probably not uncommon.
	if (!folder)
		return undefined;

	if (!allowOutsideWorkspace && (!isWithinWorkspace(folder) && workspace.workspaceFolders?.length)) {
		return undefined;
	}

	let dir = folder;
	while (dir !== path.dirname(dir)) {
		if (hasPubspec(dir) || hasPackageMapFile(dir))
			return dir;
		dir = path.dirname(dir);
	}

	return undefined;
}

export function isWithinWorkspace(file: string) {
	return !!workspace.getWorkspaceFolder(Uri.file(file));
}
