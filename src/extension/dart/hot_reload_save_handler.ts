import { commands, DiagnosticSeverity, languages, TextDocumentSaveReason, Uri, workspace } from "vscode";
import { FlutterCapabilities } from "../../shared/capabilities/flutter";
import { restartReasonSave } from "../../shared/constants";
import { IAmDisposable } from "../../shared/interfaces";
import { disposeAll } from "../../shared/utils";
import { fsPath } from "../../shared/utils/fs";
import { isWithinWorkspace } from "../../shared/vscode/project";
import { isInsideFolderNamed } from "../../shared/vscode/utils";
import { DebugCommands } from "../commands/debug";
import { config } from "../config";
import { shouldHotReloadFor } from "../utils";

export class HotReloadOnSaveHandler implements IAmDisposable {
	private disposables: IAmDisposable[] = [];
	private readonly hotReloadDelayTimers = new Map<"dart" | "flutter", NodeJS.Timeout>();

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
		if (isInsideFolderNamed(file.uri, ".dart_tool"))
			return false;

		// Bail out if we're in an external file, or not Dart.
		if (!isWithinWorkspace(fsPath(file.uri)) || !shouldHotReloadFor(file))
			return false;

		return true;
	}

	private reloadDart(saveState: { isAutoSave: boolean, isDirty: boolean }) {
		// Debounce to avoid reloading multiple times during multi-file-save (Save All).
		// Hopefully we can improve in future: https://github.com/microsoft/vscode/issues/86087
		this.scheduleReload("dart", config.hotReloadOnSave, saveState, 200, {
			onlyDart: true,
			reason: restartReasonSave,
		});
	}

	private reloadFlutter(saveState: { isAutoSave: boolean, isDirty: boolean }) {
		// We do a short debounce here to avoid many notifications when using Save All, since the debug adapter
		// will show a notification for each reload still.
		// https://github.com/Dart-Code/Dart-Code/issues/5552
		this.scheduleReload("flutter", config.flutterHotReloadOnSave, saveState, 10, {
			debounce: true,
			onlyFlutter: true,
			reason: restartReasonSave,
		});
	}

	private scheduleReload(
		key: "dart" | "flutter",
		configSetting: typeof config.hotReloadOnSave,
		{ isAutoSave, isDirty }: { isAutoSave: boolean, isDirty: boolean },
		delayMs: number,
		args: Record<string, unknown>,
	) {
		if (configSetting === "never" || (isAutoSave && (configSetting === "manual" || configSetting === "manualIfDirty")))
			return;

		if (!isDirty && (configSetting === "manualIfDirty" || configSetting === "allIfDirty"))
			return;

		const existingTimer = this.hotReloadDelayTimers.get(key);
		if (existingTimer)
			clearTimeout(existingTimer);

		this.hotReloadDelayTimers.set(key, setTimeout(() => {
			this.hotReloadDelayTimers.delete(key);
			void commands.executeCommand("dart.hotReload", args);
		}, delayMs));
	}

	public dispose(): void | Promise<void> {
		for (const timer of this.hotReloadDelayTimers.values())
			clearTimeout(timer);
		this.hotReloadDelayTimers.clear();

		disposeAll(this.disposables);
	}
}
