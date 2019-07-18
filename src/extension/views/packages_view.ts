import * as fs from "fs";
import * as path from "path";
import * as vs from "vscode";
import { DART_DEP_FILE_NODE_CONTEXT, DART_DEP_FOLDER_NODE_CONTEXT, DART_DEP_PACKAGE_NODE_CONTEXT, DART_DEP_PROJECT_NODE_CONTEXT } from "../../shared/constants";
import { Logger } from "../../shared/interfaces";
import { PackageMap } from "../../shared/pub/package_map";
import { sortBy } from "../../shared/utils/array";
import { findProjectFolders } from "../../shared/utils/fs";
import { fsPath, getDartWorkspaceFolders } from "../../shared/vscode/utils";

export class DartPackagesProvider implements vs.Disposable, vs.TreeDataProvider<PackageDep> {
	private readonly watcher: vs.FileSystemWatcher;
	private onDidChangeTreeDataEmitter: vs.EventEmitter<PackageDep | undefined> = new vs.EventEmitter<PackageDep | undefined>();
	public readonly onDidChangeTreeData: vs.Event<PackageDep | undefined> = this.onDidChangeTreeDataEmitter.event;

	constructor(private readonly logger: Logger) {
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
			const topLevelFolders = getDartWorkspaceFolders().map((w) => fsPath(w.uri));
			const allProjects = findProjectFolders(topLevelFolders, { requirePubspec: true });

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
			this.logger.warn(`Don't know how to show children of ${element.label}/${element.resourceUri}`);
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
		const children = sortBy(fs.readdirSync(fsPath(folder.resourceUri), { withFileTypes: true }), (s) => s.name.toLowerCase());
		const folders: PackageDepFolder[] = [];
		const files: PackageDepFile[] = [];

		children.forEach((child) => {
			const filePath = path.join(fsPath(folder.resourceUri), child.name);
			if (child.isFile()) {
				files.push(new PackageDepFile(vs.Uri.file(filePath)));
			} else if (child.isDirectory()) {
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
	}
}

export class PackageDepFile extends PackageDep {
	constructor(
		resourceUri: vs.Uri,
	) {
		super(undefined, resourceUri, vs.TreeItemCollapsibleState.None);
		this.contextValue = DART_DEP_FILE_NODE_CONTEXT;
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
		this.contextValue = DART_DEP_FOLDER_NODE_CONTEXT;
	}
}

export class PackageDepProject extends PackageDep {
	constructor(
		resourceUri: vs.Uri,
	) {
		const projectFolder = fsPath(resourceUri);
		super(path.basename(projectFolder), resourceUri, vs.TreeItemCollapsibleState.Collapsed);
		this.contextValue = DART_DEP_PROJECT_NODE_CONTEXT;

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
		this.contextValue = DART_DEP_PACKAGE_NODE_CONTEXT;
	}
}
