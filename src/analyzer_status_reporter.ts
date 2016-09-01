"use strict";

import { window, StatusBarItem, Disposable } from "vscode";
import { Analyzer } from "./analysis/analyzer";
import { ServerStatusNotification, ServerErrorNotification } from "./analysis/analysis_server_types";
import { config } from "./config";
import { isDevelopment, logError } from "./utils";

export class AnalyzerStatusReporter extends Disposable {
	private statusBarItem: StatusBarItem;
	private statusShowing: boolean;

	constructor(analyzer: Analyzer) {
		super(() => this.statusBarItem.dispose());

		this.statusBarItem = window.createStatusBarItem();
		this.statusBarItem.text = "Analyzing…";

		analyzer.registerForServerStatus(n => this.handleServerStatus(n));
		analyzer.registerForServerError(e => this.handleServerError(e));
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

	private handleServerError(error: ServerErrorNotification) {
		logError(error);
		if (error.stackTrace)
			console.error(error.stackTrace);
	}
}
