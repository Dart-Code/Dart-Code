import { window, workspace, TextDocument } from "vscode";
import { Analyzer } from "./analysis/analyzer";
import * as util from "./utils";

export class OpenFileTracker {
	private analyzer: Analyzer;
	private lastPriorityFiles: string[] = [];
	constructor(analyzer: Analyzer) {
		this.analyzer = analyzer;
	}

	public updatePriorityFiles() {
		// Within visible/otherActive we sort by name so we get the same results if files are in a different
		// order; this is to reduce changing too much in the AS (causing more work) since we don't really care about
		// about the relative difference within these groups.
		const visibleDocuments = window.visibleTextEditors.map((e) => e.document).sort((d1, d2) => d1.fileName.localeCompare(d2.fileName));
		const otherOpenDocuments = workspace.textDocuments.filter((doc) => visibleDocuments.indexOf(doc) === -1).sort((d1, d2) => d1.fileName.localeCompare(d2.fileName));

		const priorityDocuments = visibleDocuments.concat(otherOpenDocuments).filter((d) => this.analyzer.capabilities.supportsPriorityFilesOutsideAnalysisRoots ? util.isAnalyzable(d) : util.isAnalyzableAndInWorkspace(d));
		const priorityFiles = priorityDocuments.map((doc) => doc.fileName);

		// Check the files have changed before sending the results.
		const filesHaveChanged =
			this.lastPriorityFiles.length !== priorityFiles.length
			|| this.lastPriorityFiles.some((f, i) => f !== priorityFiles[i]);

		if (!filesHaveChanged)
			return;

		// Keep track of files to compare next time.
		this.lastPriorityFiles = priorityFiles;

		// Set priority files.
		this.analyzer.analysisSetPriorityFiles({
			files: priorityFiles,
			// tslint:disable-next-line:no-empty
		}).then(() => { }, util.logError);

		// Set subscriptions.
		if (this.analyzer.capabilities.supportsClosingLabels) {
			this.analyzer.analysisSetSubscriptions({
				subscriptions: {
					CLOSING_LABELS: priorityFiles,
					OCCURRENCES: priorityFiles,
					OUTLINE: priorityFiles,
				},
			});
		} else {
			this.analyzer.analysisSetSubscriptions({
				subscriptions: {
					HIGHLIGHTS: priorityFiles,
					OCCURRENCES: priorityFiles,
					OUTLINE: priorityFiles,
				},
			});
		}
	}
}
