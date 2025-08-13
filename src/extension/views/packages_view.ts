import * as fs from "fs";
import * as path from "path";
import * as vs from "vscode";
import { DartCapabilities } from "../../shared/capabilities/dart";
import { DART_DEP_DEPENDENCIES_NODE_CONTEXT, DART_DEP_DEPENDENCY_PACKAGE_NODE_CONTEXT, DART_DEP_DEV_DEPENDENCIES_NODE_CONTEXT, DART_DEP_DEV_DEPENDENCY_PACKAGE_NODE_CONTEXT, DART_DEP_FILE_NODE_CONTEXT, DART_DEP_FOLDER_NODE_CONTEXT, DART_DEP_PACKAGE_NODE_CONTEXT, DART_DEP_PROJECT_NODE_CONTEXT, DART_DEP_PUB_HOSTED_PACKAGE_NODE_CONTEXT, DART_DEP_TRANSITIVE_DEPENDENCIES_NODE_CONTEXT, DART_DEP_TRANSITIVE_DEPENDENCY_PACKAGE_NODE_CONTEXT } from "../../shared/constants.contexts";
import { DartWorkspaceContext, IAmDisposable, Logger } from "../../shared/interfaces";
import { PubDeps, PubDepsTreePackageDependency, PubDepsTreePackageTransitiveDependency } from "../../shared/pub/deps";
import { PackageMap, PackageMapLoader } from "../../shared/pub/package_map";
import { disposeAll, notNullOrUndefined } from "../../shared/utils";
import { sortBy } from "../../shared/utils/array";
import { areSameFolder, fsPath } from "../../shared/utils/fs";
import { envUtils, ProjectFinder } from "../../shared/vscode/utils";
import { config } from "../config";

export class DartPackagesProvider implements vs.TreeDataProvider<PackageDep>, IAmDisposable {
	protected readonly disposables: vs.Disposable[] = [];
	private onDidChangeTreeDataEmitter: vs.EventEmitter<PackageDep | undefined> = new vs.EventEmitter<PackageDep | undefined>();
	public readonly onDidChangeTreeData: vs.Event<PackageDep | undefined> = this.onDidChangeTreeDataEmitter.event;
	public readonly deps: PubDeps;
	public readonly packageMapLoader: PackageMapLoader;

	private processPackageMapChangeEvents = true;

	constructor(private readonly logger: Logger, public readonly projectFinder: ProjectFinder, private readonly context: DartWorkspaceContext, private readonly dartCapabilities: DartCapabilities) {
		this.disposables.push(vs.commands.registerCommand("_dart.removeDependencyFromTreeNode", this.removeDependency, this));
		this.disposables.push(vs.commands.registerCommand("_dart.openDependencyPageFromTreeNode", this.openDependencyPage, this));
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
		this.deps = new PubDeps(logger, context, dartCapabilities);
		this.packageMapLoader = new PackageMapLoader(logger);
	}

	public getTreeItem(element: PackageDep): vs.TreeItem {
		return element;
	}

	public async getChildren(element?: PackageDep): Promise<PackageDep[]> {
		if (!element) {
			const allProjects = await this.projectFinder.findAllProjectFolders({ requirePubspec: true, sort: true, searchDepth: config.projectSearchDepth });

			const nodes = allProjects.map((folder) => new PackageDepProject(vs.Uri.file(folder)));
			// If there's only one, just skip over to the deps.
			return nodes.length === 1
				? this.getChildren(nodes[0])
				: nodes;

		} else if (element instanceof PackageDepProject) {
			const rootPackageFolder = element.rootPackageFolder;
			// Fetch dependencies with "pub deps --json".
			const packageMap = this.packageMapLoader.loadForProject(rootPackageFolder);
			const root = await this.deps.getTree(rootPackageFolder);
			const rootPackage = root?.roots.at(0); // TODO(dantup): Fix this!

			const dependencies = rootPackage?.dependencies ?? [];
			const devDependencies = rootPackage?.devDependencies ?? [];
			const transitiveDependencies = rootPackage?.transitiveDependencies ?? [];

			const dependenciesNodes = dependencies.map((dep) => this.createDependencyNode(packageMap, rootPackageFolder, dep, DART_DEP_DEPENDENCY_PACKAGE_NODE_CONTEXT)).filter(notNullOrUndefined);
			const devDependenciesNodes = devDependencies.map((dep) => this.createDependencyNode(packageMap, rootPackageFolder, dep, DART_DEP_DEV_DEPENDENCY_PACKAGE_NODE_CONTEXT)).filter(notNullOrUndefined);
			const transitiveDependenciesNodes = transitiveDependencies.map((dep) => this.createDependencyNode(packageMap, rootPackageFolder, dep, DART_DEP_TRANSITIVE_DEPENDENCY_PACKAGE_NODE_CONTEXT)).filter(notNullOrUndefined);

			// Split the packages into groups.
			const nodes: PackageDepProjectPackageGroup[] = [];
			if (dependenciesNodes.length)
				nodes.push(new PackageDepProjectPackageGroup("direct dependencies", DART_DEP_DEPENDENCIES_NODE_CONTEXT, dependenciesNodes));
			if (devDependenciesNodes.length)
				nodes.push(new PackageDepProjectPackageGroup("dev dependencies", DART_DEP_DEV_DEPENDENCIES_NODE_CONTEXT, devDependenciesNodes));
			if (transitiveDependenciesNodes.length)
				nodes.push(new PackageDepProjectPackageGroup("transitive dependencies", DART_DEP_TRANSITIVE_DEPENDENCIES_NODE_CONTEXT, transitiveDependenciesNodes));

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
			this.logger.warn(`Don't know how to show children of ${typeof element.label === "string" ? element.label : element.label?.label ?? "<unknown>"}/${element.resourceUri}`);
			return [];
		}
	}

	private createDependencyNode(packageMap: PackageMap, rootPackageFolder: string, dependency: PubDepsTreePackageDependency | PubDepsTreePackageTransitiveDependency, contextValue: string): PackageDepPackage | undefined {
		let dependencyPath = packageMap.getPackagePath(dependency.name);
		if (!dependencyPath || areSameFolder(dependencyPath, path.join(rootPackageFolder, "lib")))
			return;

		if (path.basename(dependencyPath) === "lib")
			dependencyPath = path.normalize(path.join(dependencyPath, ".."));

		const shortestPath = "shortestPath" in dependency ? dependency.shortestPath : undefined;
		const node = new PackageDepPackage(`${dependency.name}`, vs.Uri.file(dependencyPath), rootPackageFolder, shortestPath);
		node.contextValue = contextValue;
		if (node.resourceUri?.path.includes(`/hosted/`))
			node.contextValue += ` ${DART_DEP_PUB_HOSTED_PACKAGE_NODE_CONTEXT}`;
		return node;
	}

	public getFilesAndFolders(folder: PackageDepFolder): PackageDep[] {
		if (!folder.resourceUri)
			return [];

		let children: fs.Dirent[];
		try {
			children = fs.readdirSync(fsPath(folder.resourceUri), { withFileTypes: true });
		} catch {
			return [];
		}
		children = sortBy(children, (s) => s.name.toLowerCase());
		const folders: PackageDepFolder[] = [];
		const files: PackageDepFile[] = [];


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
		const projectFolder = treeNode?.rootPackageFolder;
		if (packageName && projectFolder)
			await vs.commands.executeCommand("_dart.removeDependency", treeNode.rootPackageFolder, treeNode.packageName);
	}

	private async openDependencyPage(treeNode: PackageDepPackage) {
		const packageName = treeNode?.packageName;
		if (packageName) {
			const pubHostedUrl = process.env.PUB_HOSTED_URL ?? "https://pub.dev";
			const url = `${pubHostedUrl.replace(/\/$/, "")}/packages/${packageName}`;
			await envUtils.openInBrowser(url);
		}
	}

	public dispose(): any {
		disposeAll(this.disposables);
	}
}

/// A tree node in the packages tree.
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

/// A file  within a dependency.
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

/// A folder within a dependency.
export class PackageDepFolder extends PackageDep {
	constructor(
		resourceUri: vs.Uri,
	) {
		super(undefined, resourceUri, vs.TreeItemCollapsibleState.Collapsed);
		this.contextValue = DART_DEP_FOLDER_NODE_CONTEXT;
	}
}

/// A tree node representing a project in the workspace.
export class PackageDepProject extends PackageDep {
	public readonly rootPackageFolder: string;
	constructor(
		rootPackageUri: vs.Uri,
	) {
		const rootPackageFolder = fsPath(rootPackageUri);
		const wf = vs.workspace.getWorkspaceFolder(rootPackageUri);
		const label = wf
			// Show the relative path from the wf unless it is the wf, in which case show its name.
			? path.relative(fsPath(wf.uri), rootPackageFolder) || path.basename(fsPath(wf.uri))
			: path.basename(rootPackageFolder);
		// Show folder name if there is a wf and we're not that folder.
		const description = wf && path.relative(fsPath(wf.uri), rootPackageFolder)
			? path.basename(fsPath(wf.uri))
			: undefined;

		super(label, undefined, vs.TreeItemCollapsibleState.Collapsed);
		this.rootPackageFolder = rootPackageFolder;
		this.contextValue = DART_DEP_PROJECT_NODE_CONTEXT;
		this.description = description;
	}
}

/// A tree node representing a group (dependencies, dev dependencies, transitive dependencies).
export class PackageDepProjectPackageGroup extends PackageDep {
	constructor(
		label: string,
		context: string,
		public readonly packages: PackageDepPackage[],
	) {
		super(label, undefined, vs.TreeItemCollapsibleState.Collapsed);
		this.contextValue = context;
	}
}

/// A tree node represending a dependency (of any kind).
export class PackageDepPackage extends PackageDep {
	constructor(
		public readonly packageName: string,
		resourceUri: vs.Uri,
		public readonly rootPackageFolder: string,
		shortestPath: string[] | undefined,
	) {
		super(packageName, resourceUri, vs.TreeItemCollapsibleState.Collapsed);
		this.contextValue = DART_DEP_PACKAGE_NODE_CONTEXT;

		if (shortestPath)
			this.tooltip = shortestPath.join(" → ");
	}
}
