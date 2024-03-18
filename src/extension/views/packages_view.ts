import * as fs from "fs";
import * as path from "path";
import * as vs from "vscode";
import { DartCapabilities } from "../../shared/capabilities/dart";
import { DART_DEP_DEPENDENCIES_NODE_CONTEXT, DART_DEP_DEPENDENCY_PACKAGE_NODE_CONTEXT, DART_DEP_DEV_DEPENDENCIES_NODE_CONTEXT, DART_DEP_DEV_DEPENDENCY_PACKAGE_NODE_CONTEXT, DART_DEP_FILE_NODE_CONTEXT, DART_DEP_FOLDER_NODE_CONTEXT, DART_DEP_PACKAGE_NODE_CONTEXT, DART_DEP_PROJECT_NODE_CONTEXT, DART_DEP_TRANSITIVE_DEPENDENCIES_NODE_CONTEXT, DART_DEP_TRANSITIVE_DEPENDENCY_PACKAGE_NODE_CONTEXT } from "../../shared/constants.contexts";
import { DartWorkspaceContext, IAmDisposable, Logger } from "../../shared/interfaces";
import { PubDeps, PubDepsPackage, ShortestPaths } from "../../shared/pub/deps";
import { PackageMap } from "../../shared/pub/package_map";
import { disposeAll } from "../../shared/utils";
import { sortBy } from "../../shared/utils/array";
import { areSameFolder, fsPath } from "../../shared/utils/fs";
import { getAllProjectFolders } from "../../shared/vscode/utils";
import { config } from "../config";
import { getExcludedFolders } from "../utils";

export class DartPackagesProvider implements vs.TreeDataProvider<PackageDep>, IAmDisposable {
	protected readonly disposables: vs.Disposable[] = [];
	private onDidChangeTreeDataEmitter: vs.EventEmitter<PackageDep | undefined> = new vs.EventEmitter<PackageDep | undefined>();
	public readonly onDidChangeTreeData: vs.Event<PackageDep | undefined> = this.onDidChangeTreeDataEmitter.event;
	private readonly deps: PubDeps;

	private processPackageMapChangeEvents = true;

	constructor(private readonly logger: Logger, private readonly context: DartWorkspaceContext, private readonly dartCapabilities: DartCapabilities) {
		this.disposables.push(vs.commands.registerCommand("_dart.removeDependencyFromTreeNode", this.removeDependency, this));
		context.events.onPackageMapChange.listen(() => {
			// Calling "pub deps --json" modifies .dart_tool/package_config.json which
			// causes a loop here. The file is modified, we rebuild the tree, which triggers
			// the file to be modified, which rebuilds...
			//
			// As a workaround, when this fires, suppress any further events for a short period.
			// This may result in dropped events, but it's better than the loop.
			if (!this.processPackageMapChangeEvents)
				return;
			this.processPackageMapChangeEvents = false;
			setTimeout(() => this.processPackageMapChangeEvents = true, 5000);
			this.onDidChangeTreeDataEmitter.fire(undefined);
		});
		this.deps = new PubDeps(logger, context.sdks, dartCapabilities);
	}

	public getTreeItem(element: PackageDep): vs.TreeItem {
		return element;
	}

	public async getChildren(element?: PackageDep): Promise<PackageDep[]> {
		if (!element) {
			const allProjects = await getAllProjectFolders(this.logger, getExcludedFolders, { requirePubspec: true, searchDepth: config.projectSearchDepth });

			const nodes = allProjects.map((folder) => new PackageDepProject(vs.Uri.file(folder)));
			// If there's only one, just skip over to the deps.
			return nodes.length === 1
				? this.getChildren(nodes[0])
				: nodes;

		} else if (element instanceof PackageDepProject) {
			// Try getting dependencies from `pub deps`.
			let packages: { [key: string]: PubDepsPackage } | undefined;
			let shortestPaths: ShortestPaths | undefined;
			if (this.dartCapabilities.supportsPubDepsJson) {
				// Fetch dependencies with "pub deps --json".
				const root = await this.deps.getRootDependency(element.projectFolder);
				packages = root ? this.deps.getPackageMap(root) : undefined;
				shortestPaths = packages ? this.deps.computeShortestPaths(packages) : undefined;
			}

			// Get packages from package file.
			const allPackages = await this.getPackages(element, shortestPaths);

			if (!packages)
				return allPackages;

			// Split the packages into groups.
			const directPackages = allPackages.filter((p) => packages![p.packageName]?.kind === "direct");
			const devPackages = allPackages.filter((p) => packages![p.packageName]?.kind === "dev");
			const transitivePackages = allPackages.filter((p) => packages![p.packageName]?.kind === "transitive");

			for (const p of directPackages)
				p.contextValue = DART_DEP_DEPENDENCY_PACKAGE_NODE_CONTEXT;
			for (const p of devPackages)
				p.contextValue = DART_DEP_DEV_DEPENDENCY_PACKAGE_NODE_CONTEXT;
			for (const p of transitivePackages)
				p.contextValue = DART_DEP_TRANSITIVE_DEPENDENCY_PACKAGE_NODE_CONTEXT;


			const nodes: PackageDepProjectPackageGroup[] = [];
			if (directPackages.length)
				nodes.push(new PackageDepProjectPackageGroup("direct dependencies", DART_DEP_DEPENDENCIES_NODE_CONTEXT, directPackages));
			if (devPackages.length)
				nodes.push(new PackageDepProjectPackageGroup("dev dependencies", DART_DEP_DEV_DEPENDENCIES_NODE_CONTEXT, devPackages));
			if (transitivePackages.length)
				nodes.push(new PackageDepProjectPackageGroup("transitive dependencies", DART_DEP_TRANSITIVE_DEPENDENCIES_NODE_CONTEXT, transitivePackages, shortestPaths));
			return nodes;
		} else if (element instanceof PackageDepProjectPackageGroup) {
			// For the package groups, we've already computed the children when we split
			// them into the grous, so just return them directly.
			return element.packages;
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

	private async getPackages(project: PackageDepProject, shortestPaths: ShortestPaths | undefined): Promise<PackageDepPackage[]> {
		const map = PackageMap.loadForProject(this.logger, project.projectFolder);
		const packages = map.packages;
		const packageNames = sortBy(Object.keys(packages), (s) => s.toLowerCase());

		const packageDepNodes = packageNames
			.filter((name) => packages[name] && !areSameFolder(packages[name], path.join(project.projectFolder, "lib")))
			.map((name) => {
				let packagePath = packages[name];
				if (path.basename(packagePath) === "lib")
					packagePath = path.normalize(path.join(packagePath, ".."));
				const shortestPath = shortestPaths ? shortestPaths[name] : undefined;
				return new PackageDepPackage(`${name}`, vs.Uri.file(packagePath), project.projectFolder, shortestPath);
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

	private async removeDependency(treeNode: PackageDepPackage) {
		const packageName = treeNode?.packageName;
		const projectFolder = treeNode?.projectFolder;
		if (packageName && projectFolder)
			await vs.commands.executeCommand("_dart.removeDependency", treeNode.projectFolder, treeNode.packageName);
	}

	public dispose(): any {
		disposeAll(this.disposables);
	}
}

export abstract class PackageDep extends vs.TreeItem {
	constructor(
		label: string | undefined,
		resourceUri: vs.Uri | undefined,
		collapsibleState: vs.TreeItemCollapsibleState | undefined,
	) {
		if (label) {
			super(label, collapsibleState);
			this.resourceUri = resourceUri;
		} else if (resourceUri) {
			super(resourceUri, collapsibleState);
		} else {
			super("<unnamed>", collapsibleState);
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
	public readonly projectFolder: string;
	constructor(
		projectUri: vs.Uri,
	) {
		const projectFolder = fsPath(projectUri);
		super(path.basename(projectFolder), undefined, vs.TreeItemCollapsibleState.Collapsed);
		this.projectFolder = projectFolder;
		this.contextValue = DART_DEP_PROJECT_NODE_CONTEXT;

		// Calculate relative path to the folder for the description.
		const wf = vs.workspace.getWorkspaceFolder(projectUri);
		if (wf) {
			const workspaceFolder = fsPath(wf.uri);
			this.description = path.relative(path.dirname(workspaceFolder), path.dirname(projectFolder));
		}
	}
}

export class PackageDepProjectPackageGroup extends PackageDep {
	constructor(
		label: string,
		context: string,
		public readonly packages: PackageDepPackage[],
		public readonly shortestPaths?: ShortestPaths,
	) {
		super(label, undefined, vs.TreeItemCollapsibleState.Collapsed);
		this.contextValue = context;
	}
}

export class PackageDepPackage extends PackageDep {
	constructor(
		public readonly packageName: string,
		resourceUri: vs.Uri,
		public readonly projectFolder: string,
		shortestPath: string[] | undefined,
	) {
		super(packageName, resourceUri, vs.TreeItemCollapsibleState.Collapsed);
		this.contextValue = DART_DEP_PACKAGE_NODE_CONTEXT;

		if (shortestPath)
			this.tooltip = shortestPath.join(" → ");
	}
}
