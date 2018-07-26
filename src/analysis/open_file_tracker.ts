import { Disposable, Uri, window, workspace } from "vscode";
import { IAmDisposable } from "../debug/utils";
import * as util from "../utils";
import { fsPath } from "../utils";
import { logError } from "../utils/log";
import { FoldingRegion, Occurrences, Outline } from "./analysis_server_types";
import { Analyzer } from "./analyzer";

const outlines: { [key: string]: Outline } = {};
const occurrences: { [key: string]: Occurrences[] } = {};
const folding: { [key: string]: FoldingRegion[] } = {};

export class OpenFileTracker implements IAmDisposable {
	private disposables: Disposable[] = [];
	private lastPriorityFiles: string[] = [];
	constructor(private readonly analyzer: Analyzer) {
		this.disposables.push(workspace.onDidOpenTextDocument((td) => this.updatePriorityFiles()));
		this.disposables.push(workspace.onDidCloseTextDocument((td) => {
			delete outlines[fsPath(td.uri)];
			delete occurrences[fsPath(td.uri)];
			delete folding[fsPath(td.uri)];
			this.updatePriorityFiles();
		}));
		this.disposables.push(window.onDidChangeActiveTextEditor((e) => this.updatePriorityFiles()));
		this.disposables.push(this.analyzer.registerForAnalysisOutline((o) => outlines[o.file] = o.outline));
		this.disposables.push(this.analyzer.registerForAnalysisOccurrences((o) => occurrences[o.file] = o.occurrences));
		this.disposables.push(this.analyzer.registerForAnalysisFolding((f) => folding[f.file] = f.regions));
		this.updatePriorityFiles(); // Handle already-open files.
	}

	public updatePriorityFiles() {
		// Within visible/otherActive we sort by name so we get the same results if files are in a different
		// order; this is to reduce changing too much in the AS (causing more work) since we don't really care about
		// about the relative difference within these groups.
		const visibleDocuments = window.visibleTextEditors.map((e) => e.document).sort((d1, d2) => fsPath(d1.uri).localeCompare(fsPath(d2.uri)));
		const otherOpenDocuments = workspace.textDocuments
			.filter((doc) => !doc.isClosed)
			.filter((doc) => visibleDocuments.indexOf(doc) === -1)
			.sort((d1, d2) => fsPath(d1.uri).localeCompare(fsPath(d2.uri)));

		const priorityDocuments = visibleDocuments.concat(otherOpenDocuments).filter((d) => this.analyzer.capabilities.supportsPriorityFilesOutsideAnalysisRoots ? util.isAnalyzable(d) : util.isAnalyzableAndInWorkspace(d));
		const priorityFiles = priorityDocuments.map((doc) => fsPath(doc.uri));

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
		}).then(() => { }, logError); // tslint:disable-line:no-empty

		// Set subscriptions.
		if (this.analyzer.capabilities.supportsClosingLabels) {
			this.analyzer.analysisSetSubscriptions({
				subscriptions: {
					CLOSING_LABELS: priorityFiles,
					FOLDING: priorityFiles,
					OCCURRENCES: priorityFiles,
					OUTLINE: priorityFiles,
				},
			}).then(() => { }, logError); // tslint:disable-line:no-empty
		} else {
			this.analyzer.analysisSetSubscriptions({
				subscriptions: {
					FOLDING: priorityFiles,
					HIGHLIGHTS: priorityFiles,
					OCCURRENCES: priorityFiles,
					OUTLINE: priorityFiles,
				},
			}).then(() => { }, logError); // tslint:disable-line:no-empty
		}
	}

	public static getOutlineFor(file: Uri): Outline | undefined {
		return outlines[fsPath(file)];
	}

	public static getOccurrencesFor(file: Uri): Occurrences[] | undefined {
		return occurrences[fsPath(file)];
	}

	public static getFoldingRegionsFor(file: Uri): FoldingRegion[] | undefined {
		return folding[fsPath(file)];
	}

	public dispose(): any {
		this.disposables.forEach((d) => d.dispose());
	}
}
