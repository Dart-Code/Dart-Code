// import * as path from "path";
// import * as vs from "vscode";
// import { DART_DEP_FILE_NODE_CONTEXT, DART_DEP_FOLDER_NODE_CONTEXT, DART_DEP_PACKAGE_NODE_CONTEXT, DART_DEP_PROJECT_NODE_CONTEXT } from "../../shared/constants.contexts";
// import { fsPath } from "../../shared/utils/fs";


// export abstract class PackageDep extends vs.TreeItem {
// 	constructor(
// 		label: string | undefined,
// 		resourceUri: vs.Uri | undefined,
// 		collapsibleState: vs.TreeItemCollapsibleState | undefined,
// 	) {
// 		if (label) {
// 			super(label, collapsibleState);
// 			this.resourceUri = resourceUri;
// 		} else if (resourceUri) {
// 			super(resourceUri, collapsibleState);
// 		} else {
// 			super("<unnamed>", collapsibleState);
// 		}
// 	}
// }

// export class PackageDepFile extends PackageDep {
// 	constructor(
// 		resourceUri: vs.Uri,
// 	) {
// 		super(undefined, resourceUri, vs.TreeItemCollapsibleState.None);
// 		this.contextValue = DART_DEP_FILE_NODE_CONTEXT;
// 		this.command = {
// 			arguments: [resourceUri],
// 			command: "dart.package.openFile",
// 			title: "Open File",
// 		};
// 	}
// }

// export class PackageDepFolder extends PackageDep {
// 	constructor(
// 		resourceUri: vs.Uri,
// 	) {
// 		super(undefined, resourceUri, vs.TreeItemCollapsibleState.Collapsed);
// 		this.contextValue = DART_DEP_FOLDER_NODE_CONTEXT;
// 	}
// }

// export class PackageDepProject extends PackageDep {
// 	public readonly projectFolder: string;
// 	constructor(
// 		projectUri: vs.Uri,
// 	) {
// 		const projectFolder = fsPath(projectUri);
// 		super(path.basename(projectFolder), undefined, vs.TreeItemCollapsibleState.Collapsed);
// 		this.projectFolder = projectFolder;
// 		this.contextValue = DART_DEP_PROJECT_NODE_CONTEXT;

// 		// Calculate relative path to the folder for the description.
// 		const wf = vs.workspace.getWorkspaceFolder(projectUri);
// 		if (wf) {
// 			const workspaceFolder = fsPath(wf.uri);
// 			this.description = path.relative(path.dirname(workspaceFolder), path.dirname(projectFolder));
// 		}
// 	}
// }

// export class PackageDepProjectPackageGroup extends PackageDep {
// 	constructor(
// 		label: string,
// 		context: string,
// 		public readonly packages: PackageDepPackage[],
// 	) {
// 		super(label, undefined, vs.TreeItemCollapsibleState.Collapsed);
// 		this.contextValue = context;
// 	}
// }

// export class PackageDepPackage extends PackageDep {
// 	constructor(
// 		public readonly packageName: string,
// 		resourceUri: vs.Uri,
// 		public readonly projectFolder: string,
// 		shortestPath: string[] | undefined,
// 	) {
// 		super(packageName, resourceUri, vs.TreeItemCollapsibleState.Collapsed);
// 		this.contextValue = DART_DEP_PACKAGE_NODE_CONTEXT;

// 		if (shortestPath)
// 			this.tooltip = shortestPath.join(" → ");
// 	}
// }
