import * as path from "path";
import { Uri, workspace } from "vscode";
import { IAmDisposable, Logger } from "../../shared/interfaces";
import { disposeAll } from "../../shared/utils";
import { fsPath, projectReferencesFlutter } from "../../shared/utils/fs";
import { WorkspaceContext } from "../../shared/workspace";
import { promptToReloadExtension } from "../utils";

/**
 * Watches for new Flutter projects being added to Dart-only workspaces.
 *
 * When a Flutter project is detected, prompts the user to reload the extension
 * to enable Flutter support.
 */
export class FlutterProjectWatcher implements IAmDisposable {
	private readonly disposables: IAmDisposable[] = [];
	private hasPrompted = false; // Don't trigger multiple times if multiple pubspecs change.

	constructor(
		private readonly logger: Logger,
		private readonly workspaceContext: WorkspaceContext,
	) {
		const watcher = workspace.createFileSystemWatcher("**/pubspec.yaml");
		this.disposables.push(watcher);
		this.disposables.push(watcher.onDidCreate(this.handlePubspecChange.bind(this)));
		this.disposables.push(watcher.onDidChange(this.handlePubspecChange.bind(this)));
	}

	private handlePubspecChange(uri: Uri): void {
		if (this.hasPrompted)
			return;

		// We should not have set the watcher up if we're already in Flutter mode, but just in case...
		if (this.workspaceContext.hasAnyFlutterProjects) {
			this.logger.info("[FlutterWatcher] Workspace already has Flutter projects so ignoring change");
			return;
		}

		const filePath = fsPath(uri);

		if (filePath.includes(`${path.sep}.`) || filePath.includes(`${path.sep}build${path.sep}`)) {
			this.logger.info(`[FlutterWatcher] Skipping pubspec change for ignored folder ${filePath}`);
			return;
		}

		const folderPath = path.dirname(filePath);
		if (projectReferencesFlutter(folderPath)) {
			this.hasPrompted = true;
			this.logger.info(`[FlutterWatcher] Detected a new Flutter project at ${folderPath}`);

			// We only prompt once per session, so we can dispose our watcher.
			this.dispose();

			void promptToReloadExtension(
				this.logger,
				"A Flutter project was added to the workspace. Reload to switch to the Flutter SDK?",
				"Reload",
			);
		}
	}

	public dispose(): void {
		disposeAll(this.disposables);
	}
}
