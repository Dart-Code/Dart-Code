import * as fs from "fs";
import * as path from "path";

export function findPackageRoots(root: string): string[] {
	// For repos with code inside a "packages" folder, the analyzer doesn't resolve package paths
	// correctly. Until this is fixed in the analyzer, detect this and perform a workaround.
	// This introduces other issues, so don't do it unless we know we need to (eg. flutter repo).
	//
	// See also:
	//   https://github.com/Dart-Code/Dart-Code/issues/275 - Original issue (flutter repo not resolving correctly)
	//   https://github.com/Dart-Code/Dart-Code/issues/280 - Issue introduced by the workaround
	//   https://github.com/dart-lang/sdk/issues/29414 - Analyzer issue (where the real fix will be)

	if (!isPackageRootWorkaroundRequired(root))
		return [root];

	console.log("Workspace root appears to need package root workaround...");

	const roots = getChildren(root, 3);

	if (roots.length === 0 || fs.existsSync(path.join(root, "pubspec.yaml")))
		roots.push(root);

	return roots;

	function getChildren(parent: string, numLevels: number): string[] {
		let packageRoots: string[] = [];
		const dirs = fs.readdirSync(parent).filter((item) => fs.statSync(path.join(parent, item)).isDirectory());
		dirs.forEach((folder) => {
			const folderPath = path.join(parent, folder);
			// If this is a package, add it. Else, recurse (if we still have levels to go).
			if (fs.existsSync(path.join(folderPath, "pubspec.yaml"))) {
				packageRoots.push(folderPath);
			} else if (numLevels > 1)
				packageRoots = packageRoots.concat(getChildren(folderPath, numLevels - 1));
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
