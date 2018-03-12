import * as vs from "vscode";
import { isAnalyzable } from "../utils";

export class StatusBarVersionTracker implements vs.Disposable {
	private subscriptions: vs.Disposable[] = [];
	private statusBarItem: vs.StatusBarItem;

	constructor(version: string, tooltip: string, command?: string) {
		this.statusBarItem = vs.window.createStatusBarItem(vs.StatusBarAlignment.Right, 1);
		this.statusBarItem.text = version;
		this.statusBarItem.tooltip = tooltip;
		this.statusBarItem.command = command;
		this.subscriptions.push(this.statusBarItem);
		this.subscriptions.push(vs.window.onDidChangeActiveTextEditor((e) => {
			console.log(e && e.document && e.document.uri);
			if (e && e.document && isAnalyzable(e.document))
				this.statusBarItem.show();
			else
				this.statusBarItem.hide();
		}));
	}

	public dispose() {
		this.subscriptions.forEach((s) => s.dispose());
	}
}
