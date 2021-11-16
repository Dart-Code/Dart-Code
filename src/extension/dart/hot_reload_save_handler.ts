import * as path from "path";
import { commands, DiagnosticSeverity, languages, TextDocumentSaveReason, Uri, workspace } from "vscode";
import { FlutterCapabilities } from "../../shared/capabilities/flutter";
import { restartReasonSave } from "../../shared/constants";
import { VmService } from "../../shared/enums";
import { IAmDisposable } from "../../shared/interfaces";
import { disposeAll } from "../../shared/utils";
import { fsPath } from "../../shared/utils/fs";
import { DebugCommands } from "../commands/debug";
import { config } from "../config";
import { isWithinWorkspace, shouldHotReloadFor } from "../utils";

export class HotReloadOnSaveHandler implements IAmDisposable {
	private disposables: IAmDisposable[] = [];
	private flutterHotReloadDelayTimer: NodeJS.Timer | undefined;
	private dartHotReloadDelayTimer: NodeJS.Timer | undefined;

	// Track save reason so we can avoid hot reloading on auto-saves.
	private lastSaveReason: TextDocumentSaveReason | undefined;

	constructor(private readonly debugCommands: DebugCommands, private readonly flutterCapabilities: FlutterCapabilities) {
		// Non-FS-watcher version (onDidSave).
		this.disposables.push(workspace.onWillSaveTextDocument((e) => this.lastSaveReason = e.reason));
		this.disposables.push(workspace.onDidSaveTextDocument((td) => {
			// Bail if we're using fs-watcher instead. We still wire this
			// handler up so we don't need to reload for this setting change.
			if (config.previewHotReloadOnSaveWatcher)
				return;

			this.triggerReload(td);
		}));

		// FS-watcher version.
		// TODO: Make this support everything that shouldHotReloadFor() does.
		const watcher = workspace.createFileSystemWatcher("**/*.dart");
		this.disposables.push(watcher);
		watcher.onDidChange(this.handleFileSystemChange, this);
		watcher.onDidCreate(this.handleFileSystemChange, this);
	}

	private handleFileSystemChange(uri: Uri) {
		// Bail if we're not using fs-watcher instead. We still wire this
		// handler up so we don't need to reload for this setting change.
		if (!config.previewHotReloadOnSaveWatcher)
			return;

		this.triggerReload({ uri });
	}

	private triggerReload(file: { uri: Uri, isUntitled?: boolean, languageId?: string }) {
		const isAutoSave = this.lastSaveReason === TextDocumentSaveReason.FocusOut ||
			this.lastSaveReason === TextDocumentSaveReason.AfterDelay;

		// Never do anything for files inside .dart_tool folders.
		if (fsPath(file.uri).indexOf(`${path.sep}.dart_tool${path.sep}`) !== -1)
			return;

		// Bail out if we're in an external file, or not Dart.
		if (!isWithinWorkspace(fsPath(file.uri)) || !shouldHotReloadFor(file))
			return;

		// Don't do if we have errors for the saved file.
		const errors = languages.getDiagnostics(file.uri);
		const hasErrors = errors && !!errors.find((d) => d.source === "dart" && d.severity === DiagnosticSeverity.Error);
		if (hasErrors)
			return;

		this.reloadDart(isAutoSave);
		this.reloadFlutter(isAutoSave);
	}

	private reloadDart(isAutoSave: boolean) {
		const configSetting = config.hotReloadOnSave;
		if (configSetting === "never" || (isAutoSave && configSetting === "manual"))
			return;


		const commandToRun = "dart.hotReload";
		const args = {
			onlyDart: true,
			reason: restartReasonSave,
		};

		// Debounce to avoid reloading multiple times during multi-file-save (Save All).
		// Hopefully we can improve in future: https://github.com/microsoft/vscode/issues/86087
		if (this.dartHotReloadDelayTimer) {
			clearTimeout(this.dartHotReloadDelayTimer);
		}

		this.dartHotReloadDelayTimer = setTimeout(() => {
			this.dartHotReloadDelayTimer = undefined;
			commands.executeCommand(commandToRun, args);
		}, 200);
	}

	private reloadFlutter(isAutoSave: boolean) {
		const configSetting = config.flutterHotReloadOnSave;
		if (configSetting === "never" || (isAutoSave && configSetting === "manual"))
			return;

		const shouldHotReload = this.debugCommands.vmServices.serviceIsRegistered(VmService.HotReload);

		const shouldHotRestart =
			!this.debugCommands.vmServices.serviceIsRegistered(VmService.HotReload)
			&& this.debugCommands.vmServices.serviceIsRegistered(VmService.HotRestart)
			&& config.flutterHotRestartOnSave;

		// Don't do if there are no debug sessions that support it.
		if (!shouldHotReload && !shouldHotRestart)
			return;

		const commandToRun = shouldHotReload ? "dart.hotReload" : "flutter.hotRestart";
		const args = {
			debounce: this.flutterCapabilities.supportsRestartDebounce,
			onlyFlutter: true,
			reason: restartReasonSave,
		};

		if (this.flutterCapabilities.supportsRestartDebounce) {
			commands.executeCommand(commandToRun, args);
		} else {
			// Debounce to avoid reloading multiple times during multi-file-save (Save All).
			// Hopefully we can improve in future: https://github.com/microsoft/vscode/issues/86087
			if (this.flutterHotReloadDelayTimer) {
				clearTimeout(this.flutterHotReloadDelayTimer);
			}

			this.flutterHotReloadDelayTimer = setTimeout(() => {
				this.flutterHotReloadDelayTimer = undefined;
				commands.executeCommand(commandToRun, args);
			}, 200);
		}
	}

	public dispose(): void | Promise<void> {
		if (this.dartHotReloadDelayTimer)
			clearTimeout(this.dartHotReloadDelayTimer);
		if (this.flutterHotReloadDelayTimer)
			clearTimeout(this.flutterHotReloadDelayTimer);

		disposeAll(this.disposables);
	}
}
