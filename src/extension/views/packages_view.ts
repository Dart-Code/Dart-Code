import * as fs from "fs";
import * as path from "path";
import * as vs from "vscode";
import { DART_DEP_FILE_NODE_CONTEXT, DART_DEP_FOLDER_NODE_CONTEXT, DART_DEP_PACKAGE_NODE_CONTEXT, DART_DEP_PROJECT_NODE_CONTEXT } from "../../shared/constants";
import { Logger } from "../../shared/interfaces";
import { PackageMap } from "../../shared/pub/package_map";
import { sortBy } from "../../shared/utils/array";
import { areSameFolder, findProjectFolders, fsPath } from "../../shared/utils/fs";
import { getDartWorkspaceFolders } from "../../shared/vscode/utils";
import { WorkspaceContext } from "../../shared/workspace";

export class DartPackagesProvider implements vs.Disposable, vs.TreeDataProvider<PackageDep> {
	private readonly watcher: vs.FileSystemWatcher;
	private onDidChangeTreeDataEmitter: vs.EventEmitter<PackageDep | undefined> = new vs.EventEmitter<PackageDep | undefined>();
	public readonly onDidChangeTreeData: vs.Event<PackageDep | undefined> = this.onDidChangeTreeDataEmitter.event;

	constructor(private readonly logger: Logger, private readonly context: WorkspaceContext) {
		context.events.onPackageMapChange.listen(() => {
			this.onDidChangeTreeDataEmitter.fire(undefined)
		});
	}

	public getTreeItem(element: PackageDep): vs.TreeItem {
		return element;
	}

	public async getChildren(element?: PackageDep): Promise<PackageDep[]> {
		if (!element) {
			const topLevelFolders = getDartWorkspaceFolders().map((w) => fsPath(w.uri));
			const allProjects = await findProjectFolders(topLevelFolders, { requirePubspec: true });

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
		const projectFolder = fsPath(project.resourceUri!);

		const map = PackageMap.loadForProject(this.logger, projectFolder);
		const packages = map.packages;
		const packageNames = sortBy(Object.keys(packages), (s) => s.toLowerCase());

		const packageDepNodes = packageNames
			.filter((name) => packages[name] && !areSameFolder(packages[name], path.join(projectFolder, "lib")))
			.map((name) => {
				const path = packages[name];
				return new PackageDepPackage(`${name}`, vs.Uri.file(path));
			});

		return packageDepNodes;
	}

	private getFilesAndFolders(folder: PackageDepFolder): PackageDep[] {
		const children = sortBy(fs.readdirSync(fsPath(folder.resourceUri!), { withFileTypes: true }), (s) => s.name.toLowerCase());
		const folders: PackageDepFolder[] = [];
		const files: PackageDepFile[] = [];

		if (!folder.resourceUri)
			return [];

		const folderPath = fsPath(folder.resourceUri);
		children.forEach((child) => {
			const filePath = path.join(folderPath, child.name);
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
		label: string | undefined,
		resourceUri: vs.Uri,
		collapsibleState: vs.TreeItemCollapsibleState | undefined,
	) {
		if (label) {
			super(label, collapsibleState);
			this.resourceUri = resourceUri;
		} else {
			super(resourceUri, collapsibleState);
		}
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
		if (wf) {
			const workspaceFolder = fsPath(wf.uri);
			this.description = path.relative(path.dirname(workspaceFolder), path.dirname(projectFolder));
		}
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
