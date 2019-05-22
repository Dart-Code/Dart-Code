import * as path from "path";
import { commands, debug, DiagnosticCollection, DiagnosticSeverity, ExtensionContext, workspace } from "vscode";
import { DebugCommands } from "../commands/debug";
import { config } from "../config";
import { restartReasonSave } from "../constants";
import { fsPath, isAnalyzableAndInWorkspace } from "../utils";
import { FlutterService } from "./vm_service_extensions";

export function setUpHotReloadOnSave(context: ExtensionContext, diagnostics: DiagnosticCollection, debugCommands: DebugCommands) {
	let hotReloadDelayTimer: NodeJS.Timer | undefined;
	context.subscriptions.push(workspace.onDidSaveTextDocument((td) => {
		if (!debug.activeDebugSession)
			return;

		const shouldHotReload =
			debugCommands.flutterExtensions.serviceIsRegistered(FlutterService.HotReload)
			&& config.flutterHotReloadOnSave;

		const shouldHotRestart =
			!debugCommands.flutterExtensions.serviceIsRegistered(FlutterService.HotReload)
			&& debugCommands.flutterExtensions.serviceIsRegistered(FlutterService.HotRestart)
			&& config.flutterHotRestartOnSave;

		// Don't do if there are no debug sessions that support it.
		if (!shouldHotReload && !shouldHotRestart)
			return;

		const commandToRun = shouldHotReload ? "flutter.hotReload" : "flutter.hotRestart";

		// Bail out if we're in an external file, or not Dart.
		if (!isAnalyzableAndInWorkspace(td) || path.extname(fsPath(td.uri)) !== ".dart")
			return;

		// Don't do if we have errors for the saved file.
		const errors = diagnostics.get(td.uri);
		const hasErrors = errors && !!errors.find((d) => d.severity === DiagnosticSeverity.Error);
		if (hasErrors)
			return;

		// Debounce to avoid reloading multiple times during multi-file-save (Save All).
		// Hopefully we can improve in future: https://github.com/Microsoft/vscode/issues/42913
		if (hotReloadDelayTimer) {
			clearTimeout(hotReloadDelayTimer);
		}

		hotReloadDelayTimer = setTimeout(() => {
			hotReloadDelayTimer = undefined;
			commands.executeCommand(commandToRun, { reason: restartReasonSave });
		}, 200);
	}));
}
