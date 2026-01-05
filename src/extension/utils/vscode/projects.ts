import * as path from "path";
import * as vs from "vscode";
import { Uri } from "vscode";
import { Logger } from "../../../shared/interfaces";
import { notUndefined } from "../../../shared/utils";
import { fsPath, homeRelativePath, isFlutterProjectFolder } from "../../../shared/utils/fs";
import { getActiveRealFileEditor } from "../../../shared/vscode/editors";
import { locateBestProjectRoot } from "../../../shared/vscode/project";
import { getAllProjectFolders } from "../../../shared/vscode/utils";
import { config } from "../../config";
import { getExcludedFolders } from "../../utils";

export async function getFolderToRunCommandIn(logger: Logger, placeHolder: string, selection?: vs.Uri, flutterOnly = false): Promise<string | undefined> {
	// Attempt to find a project based on the supplied folder of active file.
	let file = selection && fsPath(selection);
	if (!file) {
		const editor = getActiveRealFileEditor();
		if (editor)
			file = fsPath(editor.document.uri);
	}
	const folder = file && locateBestProjectRoot(file, !!selection);

	if (folder)
		return folder;

	// Otherwise look for what projects we have.
	const selectableFolders = (await getAllProjectFolders(logger, getExcludedFolders, { requirePubspec: true, sort: true, searchDepth: config.projectSearchDepth }))
		.filter(flutterOnly ? isFlutterProjectFolder : () => true);

	if (!selectableFolders?.length) {
		const projectTypes = flutterOnly ? "Flutter" : "Dart/Flutter";
		void vs.window.showWarningMessage(`No ${projectTypes} project roots were found. Do you have a pubspec.yaml file?`);
		return undefined;
	}

	return showFolderPicker(selectableFolders, placeHolder); // TODO: What if the user didn't pick anything?
}

export async function getProjectSelection(logger: Logger, placeHolder: string): Promise<string[] | undefined> {
	// Attempt to find a project based on the supplied folder of active file so we can pre-selected it.
	const activeEditor = getActiveRealFileEditor();
	const activeUri = activeEditor ? activeEditor.document.uri : undefined;
	const activeFilePath = activeUri?.scheme === "file" ? fsPath(activeUri) : undefined;
	const activeProjectFolder = activeFilePath ? locateBestProjectRoot(activeFilePath) : undefined;

	// Find all possible projects.
	const selectableProjectFolders = (await getAllProjectFolders(logger, getExcludedFolders, { requirePubspec: true, sort: true, searchDepth: config.projectSearchDepth }));
	if (!selectableProjectFolders?.length) {
		void vs.window.showWarningMessage(`No project roots were found. Does your project have a pubspec.yaml file?`);
		return undefined;
	}

	if (selectableProjectFolders.length === 1) {
		return selectableProjectFolders;
	}

	const prePickedFolders = activeProjectFolder ? new Set([activeProjectFolder]) : undefined;
	return showFolderMultiPicker(selectableProjectFolders, prePickedFolders, placeHolder);
}

async function showFolderPicker(folders: string[], placeHolder: string): Promise<string | undefined> {
	// No point asking the user if there's only one.
	if (folders.length === 1) {
		return folders[0];
	}

	const items = folders.map((f) => {
		const workspaceFolder = vs.workspace.getWorkspaceFolder(Uri.file(f));
		if (!workspaceFolder)
			return undefined;

		const workspacePathParent = path.dirname(fsPath(workspaceFolder.uri));
		return {
			description: homeRelativePath(workspacePathParent),
			label: path.relative(workspacePathParent, f),
			path: f,
		} as vs.QuickPickItem & { path: string };
	}).filter(notUndefined);

	const selectedFolder = await vs.window.showQuickPick(items, { placeHolder });
	return selectedFolder && selectedFolder.path;
}

async function showFolderMultiPicker(selectableFolderPaths: string[], prePickedFolders: Set<string> | undefined, placeHolder: string): Promise<string[] | undefined> {
	// No point asking the user if there's only one.
	if (selectableFolderPaths.length === 1) {
		return selectableFolderPaths;
	}

	const items = selectableFolderPaths.map((selectableFolderPath) => {
		const workspaceFolder = vs.workspace.getWorkspaceFolder(Uri.file(selectableFolderPath));
		if (!workspaceFolder)
			return undefined;

		const workspacePathParent = path.dirname(fsPath(workspaceFolder.uri));
		return {
			description: homeRelativePath(workspacePathParent),
			label: path.relative(workspacePathParent, selectableFolderPath),
			path: selectableFolderPath,
			picked: prePickedFolders?.has(selectableFolderPath),
		} as vs.QuickPickItem & { path: string };
	}).filter(notUndefined);

	const selectedFolders = await vs.window.showQuickPick(items, { placeHolder, canPickMany: true });
	return selectedFolders?.map((folder) => folder.path);
}
