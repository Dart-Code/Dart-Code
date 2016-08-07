"use strict";

import { window, StatusBarItem, Disposable } from "vscode";
import { Analyzer } from "./analyzer";
import { ServerStatusNotification } from "./analysis_server_types";

export class AnalyzerStatusReporter extends Disposable {
	statusBarItem: StatusBarItem;
	statusShowing: boolean;

	constructor(analyzer: Analyzer) {
		super(() => this.statusBarItem.dispose());

		this.statusBarItem = window.createStatusBarItem();
		this.statusBarItem.text = "Analyzing…";

		analyzer.registerForServerStatus(n => this.handleServerStatus(n));
	}

	private handleServerStatus(status: ServerStatusNotification) {
		if (!status.analysis)
			return;

		this.statusShowing = status.analysis.isAnalyzing;

		if (this.statusShowing) {
			// Debounce short analysis times.
			setTimeout(() => {
				if (this.statusShowing)
					this.statusBarItem.show();
			}, 250);
		} else {
			this.statusBarItem.hide();
		}
	}
}
