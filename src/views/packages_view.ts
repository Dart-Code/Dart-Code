"use strict";

import * as vs from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

// TODO: Listen for changes to the .packages file.

export class DartPackagesProvider implements vs.TreeDataProvider<PackageDep> {
	private _onDidChangeTreeData: vs.EventEmitter<PackageDep | undefined> = new vs.EventEmitter<PackageDep | undefined>();
	readonly onDidChangeTreeData: vs.Event<PackageDep | undefined> = this._onDidChangeTreeData.event;

	constructor(private workspaceRoot: string) {
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
				const packagesPath = path.join(this.workspaceRoot, '.packages');
				if (this.pathExists(packagesPath)) {
					resolve(this.getDepsInPackages(packagesPath));
				}
			} else {
				return resolve([]);
			}
		});
	}

	private getDepsInPackages(packagesPath: string): PackageDep[] {
		// yaml:file:///Users/foo/.pub-cache/hosted/pub.dartlang.org/yaml-2.1.12/lib/

		if (this.pathExists(packagesPath)) {
			var lines = fs.readFileSync(packagesPath).toString().split("\n");
			lines = lines.filter(l => !l.startsWith('#') && l.trim().length > 0 && !l.endsWith(":lib/"));
			lines.sort();

			const deps = lines.map(line => {
				var pos = line.indexOf(':');
				if (pos == -1) return new PackageDep(line, null);

				var packageName = line.substring(0, pos);
				var p = line.substring(pos + 1);

				if (p.startsWith('file:') && p.endsWith('/lib/')) {
					p = p.substring(0, p.length - 5);
					packageName = p.substring(p.lastIndexOf('/') + 1);
					p = vs.Uri.parse(p).fsPath
					return new PackageDep(`${packageName}`, p, vs.TreeItemCollapsibleState.Collapsed);
				} else {
					return new PackageDep(`${packageName}`, null);
				}
			});
			return deps;
		} else {
			return [];
		}
	}

	private pathExists(p: string): boolean {
		try {
			fs.accessSync(p);
			return true;
		} catch (err) {
			return false;
		}
	}
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
