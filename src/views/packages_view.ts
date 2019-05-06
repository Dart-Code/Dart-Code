import * as fs from "fs";
import * as path from "path";
import * as vs from "vscode";
import { PackageMap } from "../debug/package_map";
import { flatMap } from "../debug/utils";
import { getChildProjects } from "../project";
import { fsPath, getDartWorkspaceFolders } from "../utils";
import { sortBy } from "../utils/array";
import { hasPackagesFile } from "../utils/fs";
import { logWarn } from "../utils/log";

export class DartPackagesProvider implements vs.Disposable, vs.TreeDataProvider<PackageDep> {
	private readonly watcher: vs.FileSystemWatcher;
	private onDidChangeTreeDataEmitter: vs.EventEmitter<PackageDep | undefined> = new vs.EventEmitter<PackageDep | undefined>();
	public readonly onDidChangeTreeData: vs.Event<PackageDep | undefined> = this.onDidChangeTreeDataEmitter.event;

	constructor() {
		this.watcher = vs.workspace.createFileSystemWatcher("**/.packages");
		this.watcher.onDidChange(this.refresh, this);
		this.watcher.onDidCreate(this.refresh, this);
		this.watcher.onDidDelete(this.refresh, this);
	}

	public refresh(): void {
		this.onDidChangeTreeDataEmitter.fire();
	}

	public getTreeItem(element: PackageDep): vs.TreeItem {
		return element;
	}

	public getChildren(element?: PackageDep): PackageDep[] {
		if (!element) {
			const topLevelDartProjects = getDartWorkspaceFolders().map((wf) => fsPath(wf.uri));
			const childProjects = flatMap(topLevelDartProjects, (f) => getChildProjects(f, 1));
			const allProjects = topLevelDartProjects.concat(childProjects).filter(hasPackagesFile);
			sortBy(allProjects, (p) => path.basename(p).toLowerCase());

			const nodes = allProjects.map((folder) => new PackageDepProject(vs.Uri.file(folder)));
			// If there's only one, just skip over to the deps.
			return nodes.length === 1
				? this.getChildren(nodes[0])
				: nodes;

		} else if (element instanceof PackageDepProject) {
			return this.getPackages(element);
		} else if (element instanceof PackageDepPackage) {
			return this.getFilesAndFolders(element);
		} else if (element instanceof PackageDepFolder) {
			return this.getFilesAndFolders(element);
		} else if (element instanceof PackageDepFile) {
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
				files.push(new PackageDepFile(vs.Uri.file(filePath)));
			} else if (stat.isDirectory()) {
				folders.push(new PackageDepFolder(vs.Uri.file(filePath)));
			}
		});

		return [...folders, ...files];
	}

	public dispose() {
		this.watcher.dispose();
	}
}

export abstract class PackageDep extends vs.TreeItem {
	constructor(
		label: string,
		resourceUri?: vs.Uri,
		collapsibleState?: vs.TreeItemCollapsibleState,
	) {
		super(label, collapsibleState);
		this.resourceUri = resourceUri;
		this.contextValue = "dependency";
	}
}

export class PackageDepFile extends PackageDep {
	constructor(
		resourceUri: vs.Uri,
	) {
		super(undefined, resourceUri, vs.TreeItemCollapsibleState.None);
		this.command = {
			arguments: [resourceUri],
			command: "dart.package.openFile",
			title: "Open File",
		};
	}
}

export class PackageDepFolder extends PackageDep {
	constructor(
		resourceUri: vs.Uri,
	) {
		super(undefined, resourceUri, vs.TreeItemCollapsibleState.Collapsed);
	}
}

export class PackageDepProject extends PackageDep {
	constructor(
		resourceUri: vs.Uri,
	) {
		const projectFolder = fsPath(resourceUri);
		super(path.basename(projectFolder), resourceUri, vs.TreeItemCollapsibleState.Collapsed);

		// Calculate relative path to the folder for the description.
		const wf = vs.workspace.getWorkspaceFolder(resourceUri);
		const workspaceFolder = fsPath(wf.uri);
		this.description = path.relative(path.dirname(workspaceFolder), path.dirname(projectFolder));
	}
}

export class PackageDepPackage extends PackageDep {
	constructor(
		label: string,
		resourceUri: vs.Uri,
	) {
		super(label, resourceUri, vs.TreeItemCollapsibleState.Collapsed);
	}
}
