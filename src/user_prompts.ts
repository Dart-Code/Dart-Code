import * as path from "path";
import * as vs from "vscode";
import { config } from "./config";
import { openInBrowser, getDartWorkspaceFolders } from "./utils";
import { Context } from "./context";

export function showUserPrompts(context: vs.ExtensionContext) {
	handleNewProjects(Context.for(context));
	// Ensure we only prompt with one question max per session!
	return (!config.closingLabels && prompt(context, "closingLabelsDisabled", promptForClosingLabelsDisabled));
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

function promptForClosingLabelsDisabled(): PromiseLike<boolean> {
	return vs.window.showInformationMessage(
		"Please consider providing feedback about Closing Labels so it may be improved",
		"Open Feedback Issue on GitHub",
	).then((res) => {
		if (res) {
			openInBrowser("https://github.com/Dart-Code/Dart-Code/issues/445");
		}
		return true; // Always mark this as done; we don't want to re-prompt if the user clicks Close.
	});
}

function error(err: any) {
	vs.window.showErrorMessage(err.message);
}

function handleNewProjects(context: Context) {
	getDartWorkspaceFolders().find((wf) => {
		const conf = config.for(wf.uri);
		if (context.newFlutterProject === wf.uri.fsPath) {
			context.newFlutterProject = undefined;
			handleFlutterWelcome(wf);
			// Bail out of find so we only do this at most once.
			return true;
		}
	});
}

function handleFlutterWelcome(workspaceFolder: vs.WorkspaceFolder) {
	vs.commands.executeCommand("vscode.open", vs.Uri.file(path.join(workspaceFolder.uri.fsPath, "lib/main.dart")));
	// TODO: Check text.
	// TODO: Do we need an option to suppress this (or should we only ever do it once?)
	vs.window.showInformationMessage("Your Flutter project has been created! Connect a device and press F5 to start running.");
}
