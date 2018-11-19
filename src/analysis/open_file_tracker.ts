import { Disposable, TextDocument, Uri, window, workspace } from "vscode";
import { IAmDisposable } from "../debug/utils";
import * as util from "../utils";
import { fsPath } from "../utils";
import { logError } from "../utils/log";
import { FoldingRegion, Occurrences, Outline } from "./analysis_server_types";
import { Analyzer } from "./analyzer";

const outlines: { [key: string]: Outline } = {};
const occurrences: { [key: string]: Occurrences[] } = {};
const folding: { [key: string]: FoldingRegion[] } = {};
let lastPriorityFiles: string[] = [];
let lastSubscribedFiles: string[] = [];

export class OpenFileTracker implements IAmDisposable {
	private disposables: Disposable[] = [];
	constructor(private readonly analyzer: Analyzer) {
		this.disposables.push(workspace.onDidOpenTextDocument((td) => this.updateSubscriptions()));
		this.disposables.push(workspace.onDidCloseTextDocument((td) => {
			delete outlines[fsPath(td.uri)];
			delete occurrences[fsPath(td.uri)];
			delete folding[fsPath(td.uri)];
			this.updateSubscriptions();
		}));
		this.disposables.push(window.onDidChangeVisibleTextEditors((e) => this.updatePriorityFiles()));
		this.disposables.push(this.analyzer.registerForAnalysisOutline((o) => outlines[o.file] = o.outline));
		this.disposables.push(this.analyzer.registerForAnalysisOccurrences((o) => occurrences[o.file] = o.occurrences));
		this.disposables.push(this.analyzer.registerForAnalysisFolding((f) => folding[f.file] = f.regions));
		// Handle already-open files.
		this.updatePriorityFiles();
		this.updateSubscriptions();
	}

	public async updatePriorityFiles() {
		const visibleFiles = this.validPathsFor(window.visibleTextEditors.map((editor) => editor.document));

		if (!this.pathsHaveChanged(lastPriorityFiles, visibleFiles))
			return;

		// Keep track of files to compare next time.
		lastPriorityFiles = visibleFiles;

		// Set priority files.
		try {
			await this.analyzer.analysisSetPriorityFiles({ files: visibleFiles });
		} catch (e) {
			logError(e);
		}
	}

	public async updateSubscriptions() {
		const openFiles = this.validPathsFor(workspace.textDocuments);

		if (!this.pathsHaveChanged(lastSubscribedFiles, openFiles))
			return;

		// Keep track of files to compare next time.
		lastSubscribedFiles = openFiles;

		// Set subscriptions.
		try {
			await this.analyzer.analysisSetSubscriptions({
				subscriptions: {
					CLOSING_LABELS: this.analyzer.capabilities.supportsClosingLabels ? openFiles : undefined,
					FOLDING: openFiles,
					OCCURRENCES: openFiles,
					OUTLINE: openFiles,
				},
			});
		} catch (e) {
			logError(e);
		}
	}

	private pathsHaveChanged(last: string[], current: string[]) {
		return last.length !== current.length
			|| last.some((f, i) => f !== current[i]);
	}

	private validPathsFor(paths: TextDocument[]): string[] {
		const isAnalyzeable = this.analyzer.capabilities.supportsPriorityFilesOutsideAnalysisRoots
			? util.isAnalyzable
			: util.isAnalyzableAndInWorkspace;

		return paths
			.filter((doc) => !doc.isClosed && isAnalyzeable(doc))
			.map((doc) => fsPath(doc.uri))
			.sort((path1, path2) => path1.localeCompare(path2));
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

	public static getLastPriorityFiles(): string[] {
		return lastPriorityFiles.slice();
	}

	public static getLastSubscribedFiles(): string[] {
		return lastSubscribedFiles.slice();
	}

	public dispose(): any {
		this.disposables.forEach((d) => d.dispose());
	}
}
