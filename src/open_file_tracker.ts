"use strict";

import { window, workspace, TextDocument } from "vscode";
import { Analyzer } from "./analysis/analyzer";
import * as util from "./utils";

export class OpenFileTracker {
	private analyzer: Analyzer;
	private lastPriorityFiles: string[] = [];
	constructor(analyzer: Analyzer) {
		this.analyzer = analyzer;
	}

	updatePriorityFiles() {
		// Within visible/otherActive we sort by name so we get the same results if files are in a different
		// order; this is to reduce changing too much in the AS (causing more work) since we don't really care about
		// about the relative difference within these groups. 
		let visibleDocuments = window.visibleTextEditors.map(e => e.document).sort((d1, d2) => d1.fileName.localeCompare(d2.fileName));
		let otherOpenDocuments = workspace.textDocuments.filter(doc => visibleDocuments.indexOf(doc) == -1).sort((d1, d2) => d1.fileName.localeCompare(d2.fileName));

		let priorityDocuments = visibleDocuments.concat(otherOpenDocuments).filter(d => util.isAnalyzable(d));
		let priorityFiles = priorityDocuments.map(doc => doc.fileName);

		// Check the files have changed before sending the results.
		let filesHaveChanged =
			this.lastPriorityFiles.length != priorityFiles.length
			|| this.lastPriorityFiles.some((f, i) => f != priorityFiles[i]);

		if (!filesHaveChanged)
			return;

		// Keep track of files to compare next time.
		this.lastPriorityFiles = priorityFiles;

		this.analyzer.analysisSetPriorityFiles({
			files: priorityFiles
		}).then(() => { }, util.logError);
	}
}