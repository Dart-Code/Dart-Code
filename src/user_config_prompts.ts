import * as vs from "vscode";
import { config } from "./config";
import { openInBrowser } from "./utils";

export function promptUserForConfigs(context: vs.ExtensionContext) {
	// Ensure we only prompt with one question max per session!
	prompt(context, 'debugJustMyCode', promptForDebugJustMyCode);
}

function prompt(context: vs.ExtensionContext, key: string, prompt: () => Thenable<boolean>) {
	let stateKey = `hasPrompted.${key}`;

	// Uncomment this to reset all state (useful for debugging).
	//context.globalState.update(stateKey, undefined);

	// If we've not prompted the user with this question before...
	if (context.globalState.get(stateKey) !== true) {
		// Prompt, but only record if the user responded.
		prompt().then(res => context.globalState.update(stateKey, res), error);
	}
}

function promptForDebugJustMyCode(): PromiseLike<boolean> {
	return vs.window.showInformationMessage(
		"Dart Code now supports debugging just your own code. Would you like to enable this?",
		"Debug just my code",
		"Debug all code",
		"More info"
	).then(res => {
		if (res === "Debug just my code") {
			config.setDebugSdkLibraries(false)
				.then(() => config.setDebugExternalLibraries(false), error);
		}
		else if (res === "Debug all code") {
			config.setDebugSdkLibraries(true)
				.then(() => config.setDebugExternalLibraries(true), error);
		}
		else if (res === "More info") {
			openInBrowser("https://github.com/Dart-Code/Dart-Code/releases/tag/v0.14.0");
		}
		return !!res;
	});
}

function error(err: any) {
	vs.window.showErrorMessage(err.message);
}
