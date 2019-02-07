import * as fs from "fs";
import * as path from "path";
import * as vs from "vscode";
import { PackageMap } from "../debug/package_map";
import { fsPath, notUndefined } from "../utils";

const DART_HIDE_PACKAGE_TREE = "dart-code:hidePackageTree";

export class DartPackagesProvider extends vs.Disposable implements vs.TreeDataProvider<PackageDep> {
	private watcher?: vs.FileSystemWatcher;
	private onDidChangeTreeDataEmitter: vs.EventEmitter<PackageDep | undefined> = new vs.EventEmitter<PackageDep | undefined>();
	public readonly onDidChangeTreeData: vs.Event<PackageDep | undefined> = this.onDidChangeTreeDataEmitter.event;
	public workspaceRoot?: string;

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
			this.watcher = undefined;
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
		DartPackagesProvider.showTree();
		this.onDidChangeTreeDataEmitter.fire();
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
						const stat = fs.statSync(filePath);
						if (stat.isFile()) {
							return new PackageDep(name, vs.Uri.file(filePath), vs.TreeItemCollapsibleState.None, {
								arguments: [vs.Uri.file(filePath)],
								command: "dart.package.openFile",
								title: "Open File",
							});
						} else if (stat.isDirectory()) {
							return new PackageDep(name, vs.Uri.file(filePath), vs.TreeItemCollapsibleState.Collapsed);
						}
					}));
				}
			} else if (this.workspaceRoot) {
				// When we're re-parsing from root, un-hide the tree. It'll be hidden if we find nothing.
				DartPackagesProvider.showTree();
				const packagesPath = PackageMap.findPackagesFile(path.join(this.workspaceRoot, ".packages"));
				if (packagesPath && fs.existsSync(packagesPath)) {
					resolve(this.getDepsInPackages(new PackageMap(packagesPath)));
				} else {
					DartPackagesProvider.hideTree();
					return resolve([]);
				}
			} else {
				// Hide the tree in the case there's no root.
				DartPackagesProvider.hideTree();
				return resolve([]);
			}
		});
	}

	private getDepsInPackages(map: PackageMap): PackageDep[] {
		const packages = map.packages;

		const packageNames = Object.keys(packages).sort();
		const deps = packageNames.map((packageName) => {
			const path = packages[packageName];
			if (this.workspaceRoot !== path) {
				return new PackageDep(`${packageName}`, vs.Uri.file(path), vs.TreeItemCollapsibleState.Collapsed);
			}
		}).filter(notUndefined);
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
	}

	public contextValue = "dependency";
}
