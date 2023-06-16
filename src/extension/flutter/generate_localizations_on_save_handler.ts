import * as path from "path";
import { commands, TextDocumentSaveReason, Uri, workspace } from "vscode";
import { IAmDisposable } from "../../shared/interfaces";
import { disposeAll } from "../../shared/utils";
import { fsPath } from "../../shared/utils/fs";
import { config } from "../config";
import { isInsideFlutterProject, isWithinWorkspace } from "../utils";

export class GenerateLocalizationsOnSaveHandler implements IAmDisposable {
	private disposables: IAmDisposable[] = [];
	private debounceDelayTimer: NodeJS.Timer | undefined;

	// Track save reason so we can avoid hot reloading on auto-saves.
	private lastSaveReason: TextDocumentSaveReason | undefined;
	// And whether any saved file was dirty to support `..ifDirty` settings.
	private isSavingDirtyFile = false;

	constructor() {
		this.disposables.push(workspace.onWillSaveTextDocument((e) => {
			if (!this.isGeneratableFile(e.document))
				return;

			this.lastSaveReason = e.reason;
			this.isSavingDirtyFile = this.isSavingDirtyFile || e.document.isDirty;
		}));
		this.disposables.push(workspace.onDidSaveTextDocument((td) => {
			this.triggerGeneration(td);
		}));
	}

	private triggerGeneration(file: { uri: Uri, isUntitled?: boolean, languageId?: string }) {
		const isAutoSave = this.lastSaveReason === TextDocumentSaveReason.FocusOut ||
			this.lastSaveReason === TextDocumentSaveReason.AfterDelay;

		// Never do anything for files inside .dart_tool folders.
		if (!this.isGeneratableFile(file))
			return;

		const isDirty = this.isSavingDirtyFile;
		this.isSavingDirtyFile = false;

		const configSetting = config.flutterGenerateLocalizationsOnSave;
		if (configSetting === "never" || (isAutoSave && (configSetting === "manual" || configSetting === "manualIfDirty")))
			return;

		if (!isDirty && (configSetting === "manualIfDirty" || configSetting === "allIfDirty"))
			return;

		const commandToRun = "flutter.task.genl10n";
		const args = [file.uri];

		// Debounce to avoid reloading multiple times during multi-file-save (Save All).
		// Hopefully we can improve in future: https://github.com/microsoft/vscode/issues/86087
		if (this.debounceDelayTimer) {
			clearTimeout(this.debounceDelayTimer);
		}

		this.debounceDelayTimer = setTimeout(() => {
			this.debounceDelayTimer = undefined;
			void commands.executeCommand(commandToRun, args);
		}, 200);
	}

	private isGeneratableFile(file: { uri: Uri, isUntitled?: boolean, languageId?: string }) {
		// Never do anything for files inside .dart_tool folders.
		if (fsPath(file.uri).indexOf(`${path.sep}.dart_tool${path.sep}`) !== -1)
			return false;

		// Bail out if we're in an external file, or not Dart.
		if (!isWithinWorkspace(fsPath(file.uri)) || !this.isArbDocument(file))
			return false;

		if (!isInsideFlutterProject(file.uri))
			return false;

		return true;
	}

	private isArbDocument(file: { uri: Uri, isUntitled?: boolean, languageId?: string }): boolean {
		if (file.isUntitled || !fsPath(file.uri) || file.uri.scheme !== "file")
			return false;

		const extName = path.extname(fsPath(file.uri));
		const extension = extName ? extName.substr(1) : undefined;

		return extension === "arb";
	}

	public dispose(): void | Promise<void> {
		if (this.debounceDelayTimer)
			clearTimeout(this.debounceDelayTimer);

		disposeAll(this.disposables);
	}
}
