import { config } from "../config";
import { ExtensionContext, DiagnosticCollection, DiagnosticSeverity, workspace, commands, TextDocument } from "vscode";

export function setUpHotReloadOnSave(context: ExtensionContext, diagnostics: DiagnosticCollection) {
	let hotReloadDelayTimer: NodeJS.Timer;
	context.subscriptions.push(workspace.onDidSaveTextDocument((td) => {
		if (!config.flutterHotReloadOnSave)
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
			hotReloadDelayTimer = null;
			commands.executeCommand("flutter.hotReload");
		}, 200);
	}));
}
