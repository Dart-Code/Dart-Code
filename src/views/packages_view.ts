import * as fs from "fs";
import * as path from "path";
import * as vs from "vscode";
import { PackageMap } from "../debug/package_map";
import { fsPath } from "../utils";
import { sortBy } from "../utils/array";
import { hasPackagesFile } from "../utils/fs";
import { logWarn } from "../utils/log";

export class DartPackagesProvider extends vs.Disposable implements vs.TreeDataProvider<PackageDep> {
	private readonly watchers: vs.FileSystemWatcher[] = [];
	private onDidChangeTreeDataEmitter: vs.EventEmitter<PackageDep | undefined> = new vs.EventEmitter<PackageDep | undefined>();
	public readonly onDidChangeTreeData: vs.Event<PackageDep | undefined> = this.onDidChangeTreeDataEmitter.event;
	public readonly workspaceFolders: string[] = [];

	constructor() {
		super(() => this.disposeWatchers());
	}

	public setWorkspaces(workspaces: vs.WorkspaceFolder[]) {
		this.disposeWatchers();
		this.workspaceFolders.length = 0;
		if (workspaces)
			this.workspaceFolders.push(...workspaces.map((wf) => fsPath(wf.uri)));
		this.createWatchers();
		this.refresh();
	}

	private disposeWatchers() {
		this.watchers.forEach((w) => w.dispose());
		this.watchers.length = 0;
	}

	private createWatchers() {
		this.disposeWatchers();
		this.watchers.push(...this.workspaceFolders.map((wf) => {
			const watcher = vs.workspace.createFileSystemWatcher(new vs.RelativePattern(wf, ".packages"));
			watcher.onDidChange(this.refresh, this);
			watcher.onDidCreate(this.refresh, this);
			watcher.onDidDelete(this.refresh, this);
			return watcher;
		}));
	}

	public refresh(): void {
		this.onDidChangeTreeDataEmitter.fire();
	}

	public getTreeItem(element: PackageDep): vs.TreeItem {
		return element;
	}

	public getChildren(element?: PackageDep): PackageDep[] {
		if (!element) {
			const foldersWithPackages = this.workspaceFolders.filter(hasPackagesFile);
			const children = foldersWithPackages.map((wf) => new PackageDepProject(path.basename(wf), vs.Uri.file(wf)));
			// If there's only one, just skip over to the deps.
			return children.length === 1
				? this.getChildren(children[0])
				: children;

		} else if (element && element instanceof PackageDepProject) {
			return this.getPackages(element);
		} else if (element && element instanceof PackageDepPackage) {
			return this.getFilesAndFolders(element);
		} else if (element && element instanceof PackageDepFolder) {
			return this.getFilesAndFolders(element);
		} else if (element && element instanceof PackageDepFile) {
			return [];
		} else {
			logWarn(`Don't know how to show children of ${element.label}/${element.resourceUri}`);
			return [];
		}
	}

	private getPackages(project: PackageDepProject): PackageDep[] {
		const map = new PackageMap(path.join(fsPath(project.resourceUri), ".packages"));
		const packages = map.packages;
		const packageNames = sortBy(Object.keys(packages), (s) => s.toLowerCase());

		return packageNames.filter((name) => name !== map.localPackageName).map((name) => {
			const path = packages[name];
			return new PackageDepPackage(`${name}`, vs.Uri.file(path));
		});
	}

	private getFilesAndFolders(folder: PackageDepFolder): PackageDep[] {
		const childNames = sortBy(fs.readdirSync(fsPath(folder.resourceUri)), (s) => s.toLowerCase());
		const folders: PackageDepFolder[] = [];
		const files: PackageDepFile[] = [];

		childNames.forEach((name) => {
			const filePath = path.join(fsPath(folder.resourceUri), name);
			const stat = fs.statSync(filePath);
			if (stat.isFile()) {
				files.push(new PackageDepFile(name, vs.Uri.file(filePath)));
			} else if (stat.isDirectory()) {
				folders.push(new PackageDepFolder(name, vs.Uri.file(filePath)));
			}
		});

		return [...folders, ...files];
	}
}

export abstract class PackageDep extends vs.TreeItem {
	constructor(
		public label: string,
		public resourceUri?: vs.Uri,
		public collapsibleState?: vs.TreeItemCollapsibleState,
	) {
		super(label, collapsibleState);
		this.resourceUri = resourceUri;
		this.contextValue = "dependency";
	}
}

export class PackageDepFile extends PackageDep {
	constructor(
		public label: string,
		public resourceUri: vs.Uri,
	) {
		super(label, resourceUri, vs.TreeItemCollapsibleState.None);
		this.command = {
			arguments: [resourceUri],
			command: "dart.package.openFile",
			title: "Open File",
		};
	}
}

export class PackageDepFolder extends PackageDep {
	constructor(
		public label: string,
		public resourceUri: vs.Uri,
	) {
		super(label, resourceUri, vs.TreeItemCollapsibleState.Collapsed);
	}
}

export class PackageDepProject extends PackageDep {
	constructor(
		public label: string,
		public resourceUri: vs.Uri,
	) {
		super(label, resourceUri, vs.TreeItemCollapsibleState.Collapsed);
	}
}

export class PackageDepPackage extends PackageDepFolder {
	constructor(
		public label: string,
		public resourceUri: vs.Uri,
	) {
		super(label, resourceUri);
	}
}
