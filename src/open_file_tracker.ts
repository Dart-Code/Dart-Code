"use strict";

import { window, workspace, TextDocument } from "vscode";
import { Analyzer } from "./analyzer";
import * as util from "./utils";

export class OpenFileTracker {
	private analyzer: Analyzer;
	private openDocuments: TextDocument[] = []; // Don't store filenames, can be renamed!
	constructor(analyzer: Analyzer) {
		this.analyzer = analyzer;
	}

	trackFile(doc: TextDocument) {
		this.openDocuments.push(doc);
		this.updatePriorityFiles();
	}

	untrackFile(doc: TextDocument) {
		let index = this.openDocuments.indexOf(doc);
		if (index >= 0) {
			this.openDocuments.splice(index, 1);
			// TODO: When a document is closed this actually fires before the visibleTextEditor
			// is removed, so we will still send the file until the next go. This isn't a big deal
			// but maybe can be improved later.
			this.updatePriorityFiles();
		}
	}

	updatePriorityFiles() {
		let visibleDocuments = window.visibleTextEditors.map(e => e.document);
		let otherOpenDocuments = this.openDocuments.filter(doc => visibleDocuments.indexOf(doc) == -1);

		let priorityDocuments = visibleDocuments.concat(otherOpenDocuments).filter(d => util.isAnalyzable(d));
		let priorityFiles = priorityDocuments.map(doc => doc.fileName);

		this.analyzer.analysisSetPriorityFiles({
			files: priorityFiles
		})
	}
}