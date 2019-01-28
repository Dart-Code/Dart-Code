import * as path from "path";
import { commands, DiagnosticCollection, DiagnosticSeverity, ExtensionContext, workspace } from "vscode";
import { debugSessions } from "../commands/debug";
import { config } from "../config";
import { restartReasonSave } from "../constants";
import { fsPath, isAnalyzableAndInWorkspace } from "../utils";
import { DartDebugSessionInformation } from "../utils/debug";

export function setUpHotReloadOnSave(context: ExtensionContext, diagnostics: DiagnosticCollection) {
	let hotReloadDelayTimer: NodeJS.Timer | undefined;
	context.subscriptions.push(workspace.onDidSaveTextDocument((td) => {
		// Bailed out if we're disabled, in an external file, or not Dart.
		if (!config.flutterHotReloadOnSave
			|| !isAnalyzableAndInWorkspace(td)
			|| path.extname(fsPath(td.uri)) !== ".dart"
		)
			return;

		// Don't do if we have errors for the saved file.
		const errors = diagnostics.get(td.uri);
		const hasErrors = errors && errors.find((d) => d.severity === DiagnosticSeverity.Error) != null;
		if (hasErrors)
			return;

		// Don't do if there are no debug sessions that support it (we need to be in Debug mode - not
		// Profile or Release - to hot reload).
		if (!debugSessions.find(allowsHotReload))
			return;

		// Debounce to avoid reloading multiple times during multi-file-save (Save All).
		// Hopefully we can improve in future: https://github.com/Microsoft/vscode/issues/42913
		if (hotReloadDelayTimer) {
			clearTimeout(hotReloadDelayTimer);
		}

		hotReloadDelayTimer = setTimeout(() => {
			hotReloadDelayTimer = undefined;
			commands.executeCommand("flutter.hotReload", { reason: restartReasonSave });
		}, 200);
	}));
}

function allowsHotReload(ds: DartDebugSessionInformation) {
	return ds && ds.session && ds.session.configuration
		&& ds.session.configuration.flutterMode !== "profile"
		&& ds.session.configuration.flutterMode !== "release";
}
