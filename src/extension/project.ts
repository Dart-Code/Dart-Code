import * as path from "path";
import { hasPackagesFile, hasPubspec } from "../shared/utils/fs";
import { isWithinWorkspace } from "./utils";

export const UPGRADE_TO_WORKSPACE_FOLDERS = "Mark Projects as Workspace Folders";

export function locateBestProjectRoot(folder: string): string | undefined {
	if (!folder || !isWithinWorkspace(folder))
		return undefined;

	let dir = folder;
	while (dir !== path.dirname(dir)) {
		if (hasPubspec(dir) || hasPackagesFile(dir))
			return dir;
		dir = path.dirname(dir);
	}

	return undefined;
}
