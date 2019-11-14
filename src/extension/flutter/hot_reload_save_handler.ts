import * as path from "path";
import { commands, DiagnosticSeverity, languages, Uri, workspace } from "vscode";
import { restartReasonSave } from "../../shared/constants";
import { FlutterService } from "../../shared/enums";
import { IAmDisposable } from "../../shared/interfaces";
import { fsPath } from "../../shared/vscode/utils";
import { DebugCommands } from "../commands/debug";
import { config } from "../config";
import { isAnalyzableAndInWorkspace } from "../utils";

export class HotReloadOnSaveHandler implements IAmDisposable {
	private disposables: IAmDisposable[] = [];
	private hotReloadDelayTimer: NodeJS.Timer | undefined;

	constructor(private readonly debugCommands: DebugCommands) {
		// Non-FS-watcher version (onDidSave).
		this.disposables.push(workspace.onDidSaveTextDocument((td) => {
			this.triggerReload(td);
		}));
	}

	private triggerReload(file: { uri: Uri, isUntitled?: boolean, languageId?: string }) {
		// Never do anything for files inside .dart_tool folders.
		if (fsPath(file.uri).indexOf(`${path.sep}.dart_tool${path.sep}`) !== -1)
			return;

		const shouldHotReload =
			this.debugCommands.flutterExtensions.serviceIsRegistered(FlutterService.HotReload)
			&& config.flutterHotReloadOnSave;

		const shouldHotRestart =
			!this.debugCommands.flutterExtensions.serviceIsRegistered(FlutterService.HotReload)
			&& this.debugCommands.flutterExtensions.serviceIsRegistered(FlutterService.HotRestart)
			&& config.flutterHotRestartOnSave;

		// Don't do if there are no debug sessions that support it.
		if (!shouldHotReload && !shouldHotRestart)
			return;

		const commandToRun = shouldHotReload ? "flutter.hotReload" : "flutter.hotRestart";

		// Bail out if we're in an external file, or not Dart.
		if (!isAnalyzableAndInWorkspace(file) || path.extname(fsPath(file.uri)) !== ".dart")
			return;

		// Don't do if we have errors for the saved file.
		const errors = languages.getDiagnostics(file.uri);
		const hasErrors = errors && errors.find((d) => d.source === "dart" && d.severity === DiagnosticSeverity.Error) != null;
		if (hasErrors)
			return;

		// Debounce to avoid reloading multiple times during multi-file-save (Save All).
		// Hopefully we can improve in future: https://github.com/Microsoft/vscode/issues/42913
		if (this.hotReloadDelayTimer) {
			clearTimeout(this.hotReloadDelayTimer);
		}

		this.hotReloadDelayTimer = setTimeout(() => {
			this.hotReloadDelayTimer = undefined;
			commands.executeCommand(commandToRun, { reason: restartReasonSave });
		}, 200);
	}

	public dispose(): void | Promise<void> {
		if (this.hotReloadDelayTimer)
			clearTimeout(this.hotReloadDelayTimer);

		this.disposables.forEach((d) => d.dispose());
	}
}
