import * as fs from "fs";
import * as path from "path";
import * as vs from "vscode";
import { PackageMap } from "../debug/package_map";
import { fsPath } from "../utils";

const DART_HIDE_PACKAGE_TREE = "dart-code:hidePackageTree";

export class DartPackagesProvider extends vs.Disposable implements vs.TreeDataProvider<PackageDep> {
	private watcher: vs.FileSystemWatcher;
	private onDidChangeTreeDataEmitter: vs.EventEmitter<PackageDep | undefined> = new vs.EventEmitter<PackageDep | undefined>();
	public readonly onDidChangeTreeData: vs.Event<PackageDep | undefined> = this.onDidChangeTreeDataEmitter.event;
	public workspaceRoot?: string;

	constructor() {
		super(() => this.watcher.dispose());
		this.watcher = vs.workspace.createFileSystemWatcher("**/.packages");
		this.watcher.onDidChange(this.refresh, this);
		this.watcher.onDidCreate(this.refresh, this);
		this.watcher.onDidDelete(this.refresh, this);
	}

	public setWorkspaces(workspaces: vs.WorkspaceFolder[]) {
		this.workspaceRoot = workspaces && workspaces.length === 1 ? fsPath(workspaces[0].uri) : undefined;
		this.refresh();
	}

	public refresh(): void {
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
					resolve(this.getDepsInPackages(packagesPath));
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

	private getDepsInPackages(packagesPath: string): PackageDep[] {
		const packageRoot = path.dirname(packagesPath);
		// yaml:file:///Users/foo/.pub-cache/hosted/pub.dartlang.org/yaml-2.1.12/lib/

		if (fs.existsSync(packagesPath)) {
			let lines = fs.readFileSync(packagesPath).toString().split("\n");
			lines = lines.filter((l) => !l.startsWith("#") && l.trim().length > 0 && !l.endsWith(":lib/"));
			lines.sort();

			const deps = lines.map((line) => {
				const pos = line.indexOf(":");
				if (pos === -1) return new PackageDep(line, null, vs.TreeItemCollapsibleState.None);

				let packageName = line.substring(0, pos);
				let p = line.substring(pos + 1);

				if (p.endsWith("/"))
					p = p.substring(0, p.length - 1);

				if (p.endsWith("/lib"))
					p = p.substring(0, p.length - 4);

				if (!p.startsWith("file:"))
					p = path.join(packageRoot, p);

				if (this.workspaceRoot !== p) {
					packageName = line.substring(0, line.indexOf(":"));
					p = fsPath(vs.Uri.parse(p));
					return new PackageDep(`${packageName}`, vs.Uri.file(p), vs.TreeItemCollapsibleState.Collapsed);
				}
			}).filter((d) => d);
			// Hide the tree if we had no dependencies to show.
			DartPackagesProvider.setTreeVisible(!!deps && !!deps.length);
			return deps;
		} else {
			// Hide the tree in the case of no packages file.
			DartPackagesProvider.hideTree();
			return [];
		}
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
