"use strict";

import * as vs from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { PackageMap } from "../debug/utils";

const DART_HIDE_PACKAGE_TREE = "dart-code:hidePackageTree";

export class DartPackagesProvider extends vs.Disposable implements vs.TreeDataProvider<PackageDep> {
	private watcher: vs.FileSystemWatcher;
	private _onDidChangeTreeData: vs.EventEmitter<PackageDep | undefined> = new vs.EventEmitter<PackageDep | undefined>();
	readonly onDidChangeTreeData: vs.Event<PackageDep | undefined> = this._onDidChangeTreeData.event;
	public workspaceRoot: string;

	constructor() {
		super(() => this.watcher.dispose());
		this.watcher = vs.workspace.createFileSystemWatcher("**/.packages");
		this.watcher.onDidChange(this.refresh, this);
		this.watcher.onDidCreate(this.refresh, this);
		this.watcher.onDidDelete(this.refresh, this);
	}

	setWorkspaces(workspaces: vs.WorkspaceFolder[]) {
		this.workspaceRoot = workspaces && workspaces.length == 1 ? workspaces[0].uri.fsPath : null;
		this.refresh();
	}

	refresh(): void {
		this._onDidChangeTreeData.fire();
	}

	getTreeItem(element: PackageDep): vs.TreeItem {
		return element;
	}

	getChildren(element?: PackageDep): Thenable<PackageDep[]> {
		return new Promise(resolve => {
			if (element) {
				if (!element.depPath) {
					return resolve([]);
				} else {
					resolve(fs.readdirSync(element.depPath).map(name => {
						var filePath = path.join(element.depPath, name);
						var stat = fs.statSync(filePath);
						if (stat.isFile()) {
							return new PackageDep(name, null, vs.TreeItemCollapsibleState.None, {
								command: 'dart.package.openFile',
								title: 'Open File',
								arguments: [vs.Uri.file(filePath).with({ scheme: "dart-package" })]
							});
						} else if (stat.isDirectory()) {
							return new PackageDep(name, filePath, vs.TreeItemCollapsibleState.Collapsed);
						}
					}));
				}
			} else if (this.workspaceRoot) {
				// When we're re-parsing from root, un-hide the tree. It'll be hidden if we find nothing.
				DartPackagesProvider.showTree();
				const packagesPath = PackageMap.findPackagesFile(path.join(this.workspaceRoot, '.packages'));
				if (packagesPath && fs.existsSync(packagesPath)) {
					resolve(this.getDepsInPackages(packagesPath));
				}
				else {
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
			var lines = fs.readFileSync(packagesPath).toString().split("\n");
			lines = lines.filter(l => !l.startsWith('#') && l.trim().length > 0 && !l.endsWith(":lib/"));
			lines.sort();

			const deps = lines.map(line => {
				var pos = line.indexOf(':');
				if (pos == -1) return new PackageDep(line, null);

				var packageName = line.substring(0, pos);
				var p = line.substring(pos + 1);

				if (p.endsWith('/'))
					p = p.substring(0, p.length - 1);

				if (p.endsWith('/lib'))
					p = p.substring(0, p.length - 4);

				if (!p.startsWith('file:'))
					p = path.join(packageRoot, p);

				if (this.workspaceRoot != p) {
					packageName = line.substring(0, line.indexOf(':'));
					p = vs.Uri.parse(p).fsPath
					return new PackageDep(`${packageName}`, p, vs.TreeItemCollapsibleState.Collapsed);
				}
			}).filter(d => d);
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
		vs.commands.executeCommand('setContext', DART_HIDE_PACKAGE_TREE, !visible);
	}

	static showTree() { this.setTreeVisible(true); }
	static hideTree() { this.setTreeVisible(false); }
}

class PackageDep extends vs.TreeItem {
	constructor(
		public readonly label: string,
		public readonly depPath: string,
		public readonly collapsibleState?: vs.TreeItemCollapsibleState,
		public readonly command?: vs.Command
	) {
		super(label, collapsibleState);
	}

	contextValue = 'dependency';
}
