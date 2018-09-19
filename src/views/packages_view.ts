import * as fs from "fs";
import * as path from "path";
import * as vs from "vscode";
import { PackageMap } from "../debug/package_map";
import { isWithinPath } from "../debug/utils";
import { fsPath } from "../utils";
import { logWarn } from "../utils/log";

const DART_HIDE_PACKAGE_TREE = "dart-code:hidePackageTree";

export class DartPackagesProvider extends vs.Disposable implements vs.TreeDataProvider<PackageDep> {
	private watcher: vs.FileSystemWatcher;
	private onDidChangeTreeDataEmitter: vs.EventEmitter<PackageDep | undefined> = new vs.EventEmitter<PackageDep | undefined>();
	public readonly onDidChangeTreeData: vs.Event<PackageDep | undefined> = this.onDidChangeTreeDataEmitter.event;
	public workspaceRoot?: string;
	private map: PackageMap;

	constructor() {
		super(() => this.disposeWatcher());
	}

	public setWorkspaces(workspaces: vs.WorkspaceFolder[]) {
		this.disposeWatcher();
		this.workspaceRoot = workspaces && workspaces.length === 1 ? fsPath(workspaces[0].uri) : undefined;
		this.createWatcher();
		this.refresh();
	}

	private disposeWatcher() {
		if (this.watcher) {
			this.watcher.dispose();
			this.watcher = null;
		}
	}

	private createWatcher() {
		if (!this.workspaceRoot)
			return;
		this.watcher = vs.workspace.createFileSystemWatcher(new vs.RelativePattern(this.workspaceRoot, ".packages"));
		this.watcher.onDidChange(this.refresh, this);
		this.watcher.onDidCreate(this.refresh, this);
		this.watcher.onDidDelete(this.refresh, this);
	}

	public refresh(): void {
		const packagesPath = PackageMap.findPackagesFile(path.join(this.workspaceRoot, ".packages"));
		this.map = packagesPath && new PackageMap(packagesPath);
		DartPackagesProvider.showTree();
		this.onDidChangeTreeDataEmitter.fire();
	}

	public highlightFile(tree: vs.TreeView<PackageDep>, uri: vs.Uri): void {
		// TODO: Unselect things when the active file isn't in the tree. Requires:
		// https://github.com/Microsoft/vscode/issues/48754
		// TODO: Also fix a bug with switching between tabs not working...
		if (!uri)
			return;

		// Get paths of known packages (excluding the main package, which isn't in this tree).
		const paths = Object.keys(this.map.packages)
			.filter((name) => name !== this.map.localPackageName)
			.map((name) => this.map.packages[name]);

		// If we're not in this list, don't try to highlight.
		if (!paths.find((p) => isWithinPath(fsPath(uri), p)))
			return;

		tree.reveal(new PackageDep(undefined, uri));
	}

	public getTreeItem(element: PackageDep): vs.TreeItem {
		return element;
	}

	public getChildren(element?: PackageDep): Thenable<PackageDep[]> {
		return new Promise((resolve) => {
			if (element) {
				if (!element.collapsibleState && !element.resourceUri) {
					return resolve([]);
				} else {
					resolve(fs.readdirSync(fsPath(element.resourceUri)).map((name) => {
						const filePath = path.join(fsPath(element.resourceUri), name);
						return this.createNode(filePath);
					}));
				}
			} else if (this.workspaceRoot) {
				// When we're re-parsing from root, un-hide the tree. It'll be hidden if we find nothing.
				DartPackagesProvider.showTree();
				resolve(this.getDepsInPackages());
			} else {
				// Hide the tree in the case there's no root.
				DartPackagesProvider.hideTree();
				return resolve([]);
			}
		});
	}

	public getParent(element: PackageDep): PackageDep {
		if (!element)
			return;
		for (const packageName of Object.keys(this.map.packages)) {
			const packagePath = this.map.packages[packageName];
			const nodePath = fsPath(element.resourceUri);
			if (nodePath === packagePath) {
				return undefined;
			} else if (isWithinPath(nodePath, packagePath)) {
				return this.createNode(path.dirname(nodePath) + path.sep);
			}
		}
		logWarn(`Packages tree was asked for parent of ${element.resourceUri} which does not appear in the package map.`);
	}

	private createNode(filePath: string) {
		const stat = fs.statSync(filePath);
		const name = path.basename(filePath);
		if (stat.isFile()) {
			return new PackageDep(name, vs.Uri.file(filePath), vs.TreeItemCollapsibleState.None, {
				arguments: [vs.Uri.file(filePath)],
				command: "dart.package.openFile",
				title: "Open File",
			});
		} else if (stat.isDirectory()) {
			return new PackageDep(name, vs.Uri.file(filePath), vs.TreeItemCollapsibleState.Collapsed);
		}
	}

	private getDepsInPackages(): PackageDep[] {
		const packages = this.map.packages;

		const packageNames = Object.keys(packages)
			.filter((name) => name !== this.map.localPackageName)
			.sort();
		const deps = packageNames.map((packageName) => {
			const path = packages[packageName];
			if (this.workspaceRoot !== path) {
				return new PackageDep(`${packageName}`, vs.Uri.file(path), vs.TreeItemCollapsibleState.Collapsed);
			}
		}).filter((d) => d);
		// Hide the tree if we had no dependencies to show.
		DartPackagesProvider.setTreeVisible(!!deps && !!deps.length);
		return deps;

	}

	private static setTreeVisible(visible: boolean) {
		vs.commands.executeCommand("setContext", DART_HIDE_PACKAGE_TREE, !visible);
	}

	public static showTree() { this.setTreeVisible(true); }
	public static hideTree() { this.setTreeVisible(false); }
}

class PackageDep extends vs.TreeItem {
	constructor(
		public readonly label: string,
		public readonly resourceUri?: vs.Uri,
		public readonly collapsibleState?: vs.TreeItemCollapsibleState,
		public readonly command?: vs.Command,
	) {
		super(label, collapsibleState);
		this.id = resourceUri.toString();
	}

	public contextValue = "dependency";
}
