import * as path from "path";
import { commands, DiagnosticSeverity, languages, TextDocumentSaveReason, Uri, workspace } from "vscode";
import { FlutterCapabilities } from "../../shared/capabilities/flutter";
import { restartReasonSave } from "../../shared/constants";
import { IAmDisposable } from "../../shared/interfaces";
import { disposeAll } from "../../shared/utils";
import { fsPath } from "../../shared/utils/fs";
import { DebugCommands } from "../commands/debug";
import { config } from "../config";
import { isWithinWorkspace, shouldHotReloadFor } from "../utils";

export class HotReloadOnSaveHandler implements IAmDisposable {
	private disposables: IAmDisposable[] = [];
	private dartHotReloadDelayTimer: NodeJS.Timeout | undefined;
	private flutterHotReloadDelayTimer: NodeJS.Timeout | undefined;

	// Track save reason so we can avoid hot reloading on auto-saves.
	private lastSaveReason: TextDocumentSaveReason | undefined;
	// And whether any saved file was dirty to support `..ifDirty` settings.
	private isSavingDirtyFile = false;

	constructor(private readonly debugCommands: DebugCommands, private readonly flutterCapabilities: FlutterCapabilities) {
		// Non-FS-watcher version (onDidSave).
		this.disposables.push(workspace.onWillSaveTextDocument((e) => {
			if (!this.isReloadableFile(e.document))
				return;

			this.lastSaveReason = e.reason;
			this.isSavingDirtyFile = this.isSavingDirtyFile || e.document.isDirty;
		}));
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
		watcher.onDidChange(this.handleFileSystemChange.bind(this));
		watcher.onDidCreate(this.handleFileSystemChange.bind(this));
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
		if (!this.isReloadableFile(file))
			return;

		const isDirty = this.isSavingDirtyFile;
		this.isSavingDirtyFile = false;

		// Don't do if we have errors for the saved file.
		const errors = languages.getDiagnostics(file.uri);
		const hasErrors = errors && !!errors.find((d) => d.source === "dart" && d.severity === DiagnosticSeverity.Error);
		if (hasErrors)
			return;

		this.reloadDart({ isAutoSave, isDirty });
		this.reloadFlutter({ isAutoSave, isDirty });
	}

	private isReloadableFile(file: { uri: Uri, isUntitled?: boolean, languageId?: string }) {
		// Never do anything for files inside .dart_tool folders.
		if (fsPath(file.uri).includes(`${path.sep}.dart_tool${path.sep}`))
			return false;

		// Bail out if we're in an external file, or not Dart.
		if (!isWithinWorkspace(fsPath(file.uri)) || !shouldHotReloadFor(file))
			return false;

		return true;
	}

	private reloadDart({ isAutoSave, isDirty }: { isAutoSave: boolean, isDirty: boolean }) {
		const configSetting = config.hotReloadOnSave;
		if (configSetting === "never" || (isAutoSave && (configSetting === "manual" || configSetting === "manualIfDirty")))
			return;

		if (!isDirty && (configSetting === "manualIfDirty" || configSetting === "allIfDirty"))
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
			void commands.executeCommand(commandToRun, args);
		}, 200);
	}

	private reloadFlutter({ isAutoSave, isDirty }: { isAutoSave: boolean, isDirty: boolean }) {
		const configSetting = config.flutterHotReloadOnSave;
		if (configSetting === "never" || (isAutoSave && (configSetting === "manual" || configSetting === "manualIfDirty")))
			return;

		if (!isDirty && (configSetting === "manualIfDirty" || configSetting === "allIfDirty"))
			return;

		const commandToRun = "dart.hotReload";
		const args = {
			debounce: true,
			onlyFlutter: true,
			reason: restartReasonSave,
		};

		// We do a short debounce here to avoid many notifications when using Save All, since the debug adapter
		// will show a notification for each reload still.
		// https://github.com/Dart-Code/Dart-Code/issues/5552
		if (this.flutterHotReloadDelayTimer) {
			clearTimeout(this.flutterHotReloadDelayTimer);
		}

		this.flutterHotReloadDelayTimer = setTimeout(() => {
			this.flutterHotReloadDelayTimer = undefined;
			void commands.executeCommand(commandToRun, args);
		}, 10);
	}

	public dispose(): void | Promise<void> {
		if (this.dartHotReloadDelayTimer)
			clearTimeout(this.dartHotReloadDelayTimer);

		disposeAll(this.disposables);
	}
}
