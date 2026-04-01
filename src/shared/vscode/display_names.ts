import * as path from "path";
import * as vs from "vscode";
import { fsPath, tryGetPackageName } from "../utils/fs";

/**
 * Gets a display string for a package to use in places like output panels.
 *
 * Generally returns `package:foo (project/foo)`, except:
 *
 * - When there is no package name, returns only the folder name `project/foo`
 * - The parent folder name is only included if it's within the workspace (and not the workspace root or outside of it)
 * - In the case where the parent folder name is not displayed and the project folder name matches the package, we only show `package:foo`
 */
export function getPackageOrFolderDisplayName(packageFolder: string, { packageName }: { packageName?: string } = {}): string {
	// If we weren't passed one, try to get the packages name from the pubspec.
	packageName ??= tryGetPackageName(packageFolder);

	// Get the relative path from the workspace root to the folder we're running up to two segments.
	const containingWorkspace = vs.workspace.getWorkspaceFolder(vs.Uri.file(packageFolder));
	const containingWorkspacePath = containingWorkspace ? fsPath(containingWorkspace.uri) : undefined;
	let folderDisplayName = path.basename(packageFolder);
	if (containingWorkspacePath) {
		const relativePath = path.relative(containingWorkspacePath, packageFolder);
		if (relativePath) {
			folderDisplayName = relativePath.includes(path.sep)
				? relativePath.split(path.sep).slice(-2).join(path.sep)
				: relativePath;
		}
	}

	if (packageName && packageName !== folderDisplayName) {
		return `package:${packageName} (${folderDisplayName})`;
	} else if (packageName) {
		return `package:${packageName}`;
	} else {
		return folderDisplayName;
	}
}
