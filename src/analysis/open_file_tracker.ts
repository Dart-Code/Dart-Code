import { window, workspace, TextDocument, Disposable, Uri } from "vscode";
import { Analyzer } from "./analyzer";
import * as util from "../utils";
import { AnalysisOutlineNotification, Outline, Occurrences } from "./analysis_server_types";

const outlines: { [key: string]: Outline } = {};
const occurrences: { [key: string]: Occurrences[] } = {};

export class OpenFileTracker implements Disposable {
	private disposables: Disposable[] = [];
	private analyzer: Analyzer;
	private lastPriorityFiles: string[] = [];
	constructor(analyzer: Analyzer) {
		this.analyzer = analyzer;
		this.disposables.push(workspace.onDidOpenTextDocument((td) => this.updatePriorityFiles()));
		this.disposables.push(workspace.onDidCloseTextDocument((td) => {
			delete outlines[td.fileName];
			delete occurrences[td.fileName];
			this.updatePriorityFiles();
		}));
		this.disposables.push(window.onDidChangeActiveTextEditor((e) => this.updatePriorityFiles()));
		this.disposables.push(this.analyzer.registerForAnalysisOutline((o) => outlines[o.file] = o.outline));
		this.disposables.push(this.analyzer.registerForAnalysisOccurrences((o) => occurrences[o.file] = o.occurrences));
		this.updatePriorityFiles(); // Handle already-open files.
	}

	public updatePriorityFiles() {
		// Within visible/otherActive we sort by name so we get the same results if files are in a different
		// order; this is to reduce changing too much in the AS (causing more work) since we don't really care about
		// about the relative difference within these groups.
		const visibleDocuments = window.visibleTextEditors.map((e) => e.document).sort((d1, d2) => d1.fileName.localeCompare(d2.fileName));
		const otherOpenDocuments = workspace.textDocuments
			.filter((doc) => !doc.isClosed)
			.filter((doc) => visibleDocuments.indexOf(doc) === -1)
			.sort((d1, d2) => d1.fileName.localeCompare(d2.fileName));

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
		}).then(() => { }, util.logError); // tslint:disable-line:no-empty

		// Set subscriptions.
		if (this.analyzer.capabilities.supportsClosingLabels) {
			this.analyzer.analysisSetSubscriptions({
				subscriptions: {
					CLOSING_LABELS: priorityFiles,
					OCCURRENCES: priorityFiles,
					OUTLINE: priorityFiles,
				},
			}).then(() => { }, util.logError); // tslint:disable-line:no-empty
		} else {
			this.analyzer.analysisSetSubscriptions({
				subscriptions: {
					HIGHLIGHTS: priorityFiles,
					OCCURRENCES: priorityFiles,
					OUTLINE: priorityFiles,
				},
			}).then(() => { }, util.logError); // tslint:disable-line:no-empty
		}
	}

	public static getOutlineFor(file: Uri): Outline | undefined {
		return outlines[file.fsPath];
	}

	public static getOccurrencesFor(file: Uri): Occurrences[] | undefined {
		return occurrences[file.fsPath];
	}

	public dispose(): any {
		this.disposables.forEach((d) => d.dispose());
	}
}
