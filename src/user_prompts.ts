import * as fs from "fs";
import * as path from "path";
import * as vs from "vscode";
import { config } from "./config";
import { Context } from "./context";
import { FLUTTER_CREATE_PROJECT_TRIGGER_FILE, extensionVersion, fsPath, getDartWorkspaceFolders, isDevExtension, openInBrowser } from "./utils";

export function showUserPrompts(context: vs.ExtensionContext) {
	handleNewProjects(Context.for(context));

	const versionMajorMinor = extensionVersion.split(".").slice(0, 2).join(".");
	return (
		(isDevExtension || prompt(context, `release_notes_${versionMajorMinor}`, () => promptToShowReleaseNotes(versionMajorMinor)))
		&& !config.closingLabels && prompt(context, "closingLabelsDisabled", promptForClosingLabelsDisabled)
	);
}

function prompt(context: vs.ExtensionContext, key: string, prompt: () => Thenable<boolean>): boolean {
	const stateKey = `hasPrompted.${key}`;

	// Uncomment this to reset all state (useful for debugging).
	// context.globalState.update(stateKey, undefined);

	// If we've not prompted the user with this question before...
	if (context.globalState.get(stateKey) !== true) {
		// Prompt, but only record if the user responded.
		prompt().then((res) => context.globalState.update(stateKey, res), error);
		return true;
	}

	return false;
}

async function promptForClosingLabelsDisabled(): Promise<boolean> {
	const res = await vs.window.showInformationMessage(
		"Please consider providing feedback about Closing Labels so it may be improved",
		"Open Feedback Issue on GitHub",
	);
	if (res) {
		openInBrowser("https://github.com/Dart-Code/Dart-Code/issues/445");
	}
	return true; // Always mark this as done; we don't want to re-prompt if the user clicks Close.
}

async function promptToShowReleaseNotes(version: string): Promise<boolean> {
	const res = await vs.window.showInformationMessage(
		`Dart Code has been updated to v${version}`,
		`Show v${version} Release Notes`,
	);
	if (res) {
		openInBrowser(`https://dartcode.org/releases/${version}/`);
	}
	return true; // Always mark this as done; we don't want to prompt the user multiple times.
}

function error(err: any) {
	vs.window.showErrorMessage(err.message);
}

function handleNewProjects(context: Context) {
	getDartWorkspaceFolders().find((wf) => {
		const triggerFile = path.join(fsPath(wf.uri), FLUTTER_CREATE_PROJECT_TRIGGER_FILE);
		if (fs.existsSync(triggerFile)) {
			fs.unlinkSync(triggerFile);
			createFlutterProject(fsPath(wf.uri)).then((success) => {
				if (success)
					handleFlutterWelcome(wf);
			});
			// Bail out of find so we only do this at most once.
			return true;
		}
	});
}

async function createFlutterProject(projectPath: string): Promise<boolean> {
	const code = await vs.commands.executeCommand("_flutter.create", projectPath) as number;
	return code === 0;
}

function handleFlutterWelcome(workspaceFolder: vs.WorkspaceFolder) {
	vs.commands.executeCommand("vscode.open", vs.Uri.file(path.join(fsPath(workspaceFolder.uri), "lib/main.dart")));
	vs.window.showInformationMessage("Your Flutter project is ready! Connect a device and press F5 to start running.");
}
