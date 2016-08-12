"use strict";

import { window, workspace, TextDocument } from "vscode";
import { Analyzer } from "./analysis/analyzer";
import * as util from "./utils";

export class OpenFileTracker {
	private analyzer: Analyzer;
	constructor(analyzer: Analyzer) {
		this.analyzer = analyzer;
	}

	updatePriorityFiles() {
		let visibleDocuments = window.visibleTextEditors.map(e => e.document);
		let otherOpenDocuments = workspace.textDocuments.filter(doc => visibleDocuments.indexOf(doc) == -1);

		let priorityDocuments = visibleDocuments.concat(otherOpenDocuments).filter(d => util.isAnalyzable(d));
		let priorityFiles = priorityDocuments.map(doc => doc.fileName);

		this.analyzer.analysisSetPriorityFiles({
			files: priorityFiles
		}).then(() => {}, e => console.warn(e.message));
	}
}