import * as path from "path";
import * as vs from "vscode";
import { modifyingFilesOutsideWorkspaceInfoUrl, moreInfoAction } from "../../shared/constants";
import { disposeAll } from "../../shared/utils";
import { fsPath } from "../../shared/utils/fs";
import { envUtils } from "../../shared/vscode/utils";
import { config } from "../config";
import * as util from "../utils";

export class FileChangeWarnings implements vs.Disposable {
	private readonly disposables: vs.Disposable[] = [];
	private readonly filesWarnedAbout = new Set<string>();
	constructor() {
		this.disposables.push(
			vs.workspace.onDidChangeTextDocument((e) => this.onDidChangeTextDocument(e))
		);
	}

	public onDidChangeTextDocument(e: vs.TextDocumentChangeEvent) {
		if (!util.isDartFile(fsPath(e.document.uri)))
			return;

		if (e.contentChanges.length === 0) // This event fires for metadata changes (dirty?) so don't need to notify AS then.
			return;

		const filePath = fsPath(e.document.uri);

		if (vs.workspace.workspaceFolders
			&& vs.workspace.workspaceFolders.length // Only prompt if we actually have workspace folders open
			&& !util.isWithinWorkspace(filePath)
			&& !this.filesWarnedAbout.has(filePath)) {

			const isInPubCache = filePath.indexOf(`${path.sep}hosted${path.sep}pub.dartlang.org${path.sep}`) !== -1;
			const shouldWarn = isInPubCache
				? config.warnWhenEditingFilesInPubCache
				: config.warnWhenEditingFilesOutsideWorkspace;
			const promptText = isInPubCache
				? "You are modifying a file in the Pub cache!"
				: "You are modifying a file outside of your open folders";
			const dontShowAgainSetter = isInPubCache
				? () => config.setWarnWhenEditingFilesInPubCache(false)
				: () => config.setWarnWhenEditingFilesOutsideWorkspace(false);
			const dontShowAgainAction = "Don't Warn Me";

			if (shouldWarn) {
				void vs.window.showWarningMessage(promptText, moreInfoAction, dontShowAgainAction)
					.then(async (action) => {
						if (action === moreInfoAction) {
							await envUtils.openInBrowser(modifyingFilesOutsideWorkspaceInfoUrl);
						} else if (action === dontShowAgainAction)
							void dontShowAgainSetter();
					});
				this.filesWarnedAbout.add(filePath);
			}
		}
	}

	public dispose(): any {
		disposeAll(this.disposables);
	}
}
