import * as fs from "fs";
import * as path from "path";
import * as vs from "vscode";
import * as util from "./utils";
import { config } from "./config";

export const UPGRADE_TO_WORKSPACE_FOLDERS = "Mark Projects as Workspace Folders";

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

function getChildProjects(folder: string, levelsToGo: number): string[] {
	const children = fs
		.readdirSync(folder)
		.filter((f) => f !== "bin") // Don't look in bin folders
		.filter((f) => f !== "cache") // Don't look in cache folders
		.map((f) => path.join(folder, f))
		.filter((d) => fs.statSync(d).isDirectory());

	let projects: string[] = [];
	for (const dir of children) {
		if (fs.existsSync(path.join(dir, "pubspec.yaml"))) {
			projects.push(dir);
		}
		if (levelsToGo > 0)
			projects = projects.concat(getChildProjects(dir, levelsToGo - 1));
	}

	return projects;
}

export async function checkForProjectsInSubFolders() {
	// TODO: This method is super slow (10x slower than any other part of startup, including
	// SDK searching). It's marked async but is actually all sync. Needs rewriting async (but
	// sadly node's fs library doesn't use Promises :()
	if (!vs.workspace.workspaceFolders)
		return;
	let projects: string[] = [];
	for (const workspaceFolder of vs.workspace.workspaceFolders) {
		projects = projects.concat(getChildProjects(workspaceFolder.uri.fsPath, 3));
	}

	const projectsToAdd = projects
		// Filter to those that aren't already roots.
		.filter((f) => vs.workspace.getWorkspaceFolder(vs.Uri.file(f)).uri.fsPath !== f)
		// Or if we're opted-out.
		.filter((f) => config.for(vs.Uri.file(f)).promptToUpgradeWorkspace);

	if (projectsToAdd.length > 0) {
		promptUserToUpgradeProjectFolders(projectsToAdd);
	}
}

async function promptUserToUpgradeProjectFolders(projectsToAdd: string[]) {
	const notForThisFolderAction = "Don't ask for this Folder";
	const res = await vs.window.showWarningMessage(
		`This folder contains ${projectsToAdd.length} projects in sub-folders. Would you like to mark them as Workspace Folders to enable all functionality?`,
		UPGRADE_TO_WORKSPACE_FOLDERS,
		notForThisFolderAction,
	);
	if (res === UPGRADE_TO_WORKSPACE_FOLDERS) {
		upgradeProjectFolders(projectsToAdd);
	} else {
		if (res === notForThisFolderAction) {
			await disablePromptToUpgradeProjectFolders(projectsToAdd);
		}
		vs.window.showWarningMessage("Some functionality may not work correctly for projects that are in sub-folders.");
	}
}

async function upgradeProjectFolders(projectsToAdd: string[]) {
	vs.workspace.updateWorkspaceFolders(
		vs.workspace.workspaceFolders.length,
		undefined,
		...projectsToAdd.map((p) => ({
			name: path.basename(p),
			uri: vs.Uri.file(p),
		})),
	);
}

async function disablePromptToUpgradeProjectFolders(projectsToAdd: string[]) {
	for (const f of projectsToAdd) {
		await config.for(vs.Uri.file(f)).setPromptToUpgradeWorkspace(false);
	}
}
