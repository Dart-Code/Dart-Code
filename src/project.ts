import * as fs from "fs";
import * as path from "path";
import * as vs from "vscode";
import * as util from "./utils";

export function locateBestProjectRoot(folder: string): string {
	if (!folder || !util.isWithinWorkspace(folder))
		return null;

	let dir = folder;
	while (dir !== path.dirname(dir)) {
		if (fs.existsSync(path.join(dir, "pubspec.yaml")))
			return dir;
		dir = path.dirname(dir);
	}

	return null;
}

function getChildProjects(folder: string): string[] {
	const children = fs
		.readdirSync(folder)
		.map((f) => path.join(folder, f))
		.filter((d) => fs.statSync(d).isDirectory());

	let projects: string[] = [];
	for (const dir of children) {
		if (fs.existsSync(path.join(dir, "pubspec.yaml"))) {
			projects.push(dir);
		}
		projects = projects.concat(getChildProjects(dir));
	}

	return projects;
}

export async function checkForProjectsInSubFolders() {
	if (!vs.workspace.workspaceFolders)
		return;
	let projects: string[] = [];
	for (const workspaceFolder of vs.workspace.workspaceFolders) {
		projects = projects.concat(getChildProjects(workspaceFolder.uri.fsPath));
	}

	// Filter to those that aren't already roots.
	const projectsToAdd = projects
		.filter((f) => vs.workspace.getWorkspaceFolder(vs.Uri.file(f)).uri.fsPath !== f);

	if (projectsToAdd.length > 0) {
		const updateWorkspaceAction = "Mark Projects as Workspace Folders";
		const res = await vs.window.showWarningMessage(
			`This folder contains ${projectsToAdd.length} projects in sub-folders. Would you like to mark them as Workspace Folders to enable all functionality?`,
			updateWorkspaceAction,
		);
		if (res === updateWorkspaceAction) {
			vs.workspace.updateWorkspaceFolders(
				vs.workspace.workspaceFolders.length,
				undefined,
				...projectsToAdd.map((p) => ({
					name: path.basename(p),
					uri: vs.Uri.file(p),
				})),
			);
		}
	}
}
