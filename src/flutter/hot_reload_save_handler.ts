import { DiagnosticCollection, DiagnosticSeverity, ExtensionContext, commands, workspace } from "vscode";
import { config } from "../config";
import { shouldTriggerHotReload } from "../utils";

export function setUpHotReloadOnSave(context: ExtensionContext, diagnostics: DiagnosticCollection) {
	let hotReloadDelayTimer: NodeJS.Timer | undefined;
	context.subscriptions.push(workspace.onDidSaveTextDocument((td) => {
		if (!config.flutterHotReloadOnSave || !shouldTriggerHotReload(td))
			return;

		// Don't do if we have errors for the saved file.
		const errors = diagnostics.get(td.uri);
		const hasErrors = errors && errors.find((d) => d.severity === DiagnosticSeverity.Error) != null;
		if (hasErrors)
			return;

		// Debounce to avoid reloading multiple times during multi-file-save (Save All).
		// Hopefully we can improve in future: https://github.com/Microsoft/vscode/issues/42913
		if (hotReloadDelayTimer) {
			clearTimeout(hotReloadDelayTimer);
		}

		hotReloadDelayTimer = setTimeout(() => {
			hotReloadDelayTimer = undefined;
			commands.executeCommand("flutter.hotReload");
		}, 200);
	}));
}
