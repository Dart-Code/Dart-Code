import * as fs from "fs";
import * as path from "path";
import * as vs from "vscode";
import { PackageMap } from "../debug/package_map";
import { fsPath, notUndefined } from "../utils";

const DART_HIDE_PACKAGE_TREE = "dart-code:hidePackageTree";
const DART_DEPENDENCIES_PACKAGE_NODE = "dart-code:dependencyPackageNode";
const DART_DEPENDENCIES_PACKAGE_FILE_NODE = "dart-code:dependencyPackageFileNode";

export class DartPackagesProvider implements vs.Disposable, vs.TreeDataProvider<PackageNode> {
	private disposables: vs.Disposable[] = [];
	private watcher?: vs.FileSystemWatcher;
	private onDidChangeTreeDataEmitter: vs.EventEmitter<PackageNode | undefined> = new vs.EventEmitter<PackageNode | undefined>();
	public readonly onDidChangeTreeData: vs.Event<PackageNode | undefined> = this.onDidChangeTreeDataEmitter.event;
	public workspaceRoot?: string;

	constructor() {
		this.disposables.push(
			vs.commands.registerCommand("dart.openDependency", this.openDependency, this),
		);
	}

	public setWorkspaces(workspaces: vs.WorkspaceFolder[]) {
		this.disposeWatcher();
		this.workspaceRoot = workspaces && workspaces.length === 1 ? fsPath(workspaces[0].uri) : undefined;
		this.createWatcher();
		this.refresh();
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

	public getTreeItem(element: PackageNode): vs.TreeItem {
		return element;
	}

	public getChildren(element?: PackageNode): Thenable<PackageNode[]> {
		return new Promise((resolve) => {
			if (element) {
				if (!element.collapsibleState && !element.resourceUri) {
					return resolve([]);
				} else {
					resolve(fs.readdirSync(fsPath(element.resourceUri)).map((name) => {
						const filePath = path.join(fsPath(element.resourceUri), name);
						const stat = fs.statSync(filePath);
						if (stat.isFile()) {
							return new PackageNode(name, vs.Uri.file(filePath), vs.TreeItemCollapsibleState.None, {
								arguments: [vs.Uri.file(filePath)],
								command: "dart.package.openFile",
								title: "Open File",
							});
						} else if (stat.isDirectory()) {
							return new PackageNode(name, vs.Uri.file(filePath), vs.TreeItemCollapsibleState.Collapsed);
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

	private getDepsInPackages(map: PackageMap): PackageNode[] {
		const packages = map.packages;

		const packageNames = Object.keys(packages).sort();
		const deps = packageNames.map((packageName) => {
			const path = packages[packageName];
			if (this.workspaceRoot !== path) {
				return new PackageRootNode(`${packageName}`, vs.Uri.file(path), vs.TreeItemCollapsibleState.Collapsed);
			}
		}).filter(notUndefined);
		// Hide the tree if we had no dependencies to show.
		DartPackagesProvider.setTreeVisible(!!deps && !!deps.length);
		return deps;
	}

	private async openDependency(node: PackageRootNode): Promise<void> {
		// Go up from lib to the parent folder.
		const folder = path.dirname(fsPath(node.resourceUri));
		const openInNewWindow = true;
		vs.commands.executeCommand("vscode.openFolder", vs.Uri.file(folder), openInNewWindow);
	}

	private disposeWatcher() {
		if (this.watcher) {
			this.watcher.dispose();
			this.watcher = undefined;
		}
	}

	public dispose(): any {
		this.disposeWatcher();
		for (const command of this.disposables)
			command.dispose();
	}

	private static setTreeVisible(visible: boolean) {
		vs.commands.executeCommand("setContext", DART_HIDE_PACKAGE_TREE, !visible);
	}

	public static showTree() { this.setTreeVisible(true); }
	public static hideTree() { this.setTreeVisible(false); }
}

class PackageNode extends vs.TreeItem {
	constructor(
		public readonly label: string,
		public readonly resourceUri?: vs.Uri,
		public readonly collapsibleState?: vs.TreeItemCollapsibleState,
		public readonly command?: vs.Command,
	) {
		super(label, collapsibleState);
	}

	public contextValue = DART_DEPENDENCIES_PACKAGE_FILE_NODE;
}

class PackageRootNode extends vs.TreeItem {
	constructor(
		public readonly label: string,
		public readonly resourceUri?: vs.Uri,
		public readonly collapsibleState?: vs.TreeItemCollapsibleState,
		public readonly command?: vs.Command,
	) {
		super(label, collapsibleState);
	}

	public contextValue = DART_DEPENDENCIES_PACKAGE_NODE;
}
