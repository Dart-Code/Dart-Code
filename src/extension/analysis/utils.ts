import * as fs from "fs";
import * as path from "path";
import { getChildFolders, hasPubspec } from "../../shared/utils/fs";
import { logInfo } from "../utils/log";
import { Analyzer } from "./analyzer";

export function findPackageRoots(analyzer: Analyzer, root: string): string[] {
	// For repos with code inside a "packages" folder, the analyzer doesn't resolve package paths
	// correctly. Until this is fixed in the analyzer, detect this and perform a workaround.
	// This introduces other issues, so don't do it unless we know we need to (eg. flutter repo).
	//
	// See also:
	//   https://github.com/Dart-Code/Dart-Code/issues/275 - Original issue (flutter repo not resolving correctly)
	//   https://github.com/Dart-Code/Dart-Code/issues/280 - Issue introduced by the workaround
	//   https://github.com/dart-lang/sdk/issues/29414 - Analyzer issue (where the real fix will be)

	if (!analyzer.capabilities.mayRequiresPackageFolderWorkaround || !isPackageRootWorkaroundRequired(root))
		return [root];

	logInfo("Workspace root appears to need package root workaround...");

	const roots = getChildren(root, 3);

	if (roots.length === 0 || hasPubspec(root))
		roots.push(root);

	return roots;

	function getChildren(parent: string, numLevels: number): string[] {
		let packageRoots: string[] = [];
		// TODO: change to getChildProjects()?
		getChildFolders(parent).forEach((folder) => {
			// If this is a package, add it. Else, recurse (if we still have levels to go).
			if (hasPubspec(folder)) {
				packageRoots.push(folder);
			} else if (numLevels > 1)
				packageRoots = packageRoots.concat(getChildren(folder, numLevels - 1));
		});
		return packageRoots;
	}
}

function isPackageRootWorkaroundRequired(root: string): boolean {
	// It's hard to tell if the packages folder is actually a real one (--packages-dir) or
	// this is a repo like Flutter, so we'll use the presence of a file we know exists only
	// in the flutter one. This is very fragile, but hopefully a very temporary workaround.
	return fs.existsSync(path.join(root, "packages", ".gitignore"))
		|| (
			// Since Flutter repro removed the .gitignore, also check if there are any non-symlinks.
			fs.existsSync(path.join(root, "packages"))
			&& !!fs.readdirSync(path.join(root, "packages"))
				.find((d) => path.join(root, "packages", d) === fs.realpathSync(path.join(root, "packages", d)))
		);
}
