import * as path from "path";
import { workspace } from "vscode";
import { hasPackageMapFile, hasPubspec } from "../shared/utils/fs";
import { isWithinWorkspace } from "./utils";

export const UPGRADE_TO_WORKSPACE_FOLDERS = "Mark Projects as Workspace Folders";

export function locateBestProjectRoot(folder: string, allowOutsideWorkspace = false): string | undefined {
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
