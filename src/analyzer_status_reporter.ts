"use strict";

import { window, StatusBarItem, Disposable } from "vscode";
import { Analyzer } from "./analyzer";
import { ServerStatusNotification } from "./analysis_server_types";

let statusBarItem: StatusBarItem;
let statusShowing: boolean;

export class AnalyzerStatusReporter extends Disposable {
	constructor(analyzer: Analyzer) {
		statusBarItem = window.createStatusBarItem();
		statusBarItem.text = 'Analyzing…';

		super(() => statusBarItem.dispose());

		analyzer.registerForServerStatus(n => this.handleServerStatus(n));
	}

	private handleServerStatus(status: ServerStatusNotification) {
		if (!status.analysis)
			return;

		statusShowing = status.analysis.isAnalyzing;

		if (statusShowing) {
			// Debounce short analysis times.
			setTimeout(() => {
				if (statusShowing)
					statusBarItem.show();
			}, 250);
		} else {
			statusBarItem.hide();
		}
	}
}
