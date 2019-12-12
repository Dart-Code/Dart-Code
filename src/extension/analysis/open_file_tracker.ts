import { Disposable, TextDocument, Uri, window, workspace } from "vscode";
import { FlutterOutline, FoldingRegion, Occurrences, Outline } from "../../shared/analysis_server_types";
import { IAmDisposable, Logger } from "../../shared/interfaces";
import { fsPath } from "../../shared/utils/fs";
import { WorkspaceContext } from "../../shared/workspace";
import { isUsingLsp } from "../extension";
import { locateBestProjectRoot } from "../project";
import * as util from "../utils";
import { DasAnalyzerClient } from "./analyzer_das";

export class DasFileTracker implements IAmDisposable {
	private disposables: Disposable[] = [];
	private readonly outlines: { [key: string]: Outline } = {};
	private readonly flutterOutlines: { [key: string]: FlutterOutline } = {};
	private readonly occurrences: { [key: string]: Occurrences[] } = {};
	private readonly folding: { [key: string]: FoldingRegion[] } = {};
	private readonly pubRunTestSupport: { [key: string]: boolean } = {};
	private lastPriorityFiles: string[] = [];
	private lastSubscribedFiles: string[] = [];

	constructor(private readonly logger: Logger, private readonly analyzer: DasAnalyzerClient, private readonly wsContext: WorkspaceContext) {
		// Reset these, since they're state from the last analysis server
		// (when we change SDK and thus change this).
		this.lastPriorityFiles = [];
		this.lastSubscribedFiles = [];

		this.disposables.push(workspace.onDidOpenTextDocument((td) => {
			this.updateSubscriptions();
		}));
		this.disposables.push(workspace.onDidCloseTextDocument((td) => {
			const path = fsPath(td.uri);
			delete this.outlines[path];
			delete this.flutterOutlines[path];
			delete this.occurrences[path];
			delete this.folding[path];
			delete this.pubRunTestSupport[path];
			this.updateSubscriptions();
		}));
		this.disposables.push(window.onDidChangeVisibleTextEditors((e) => this.updatePriorityFiles()));
		this.disposables.push(this.analyzer.registerForAnalysisOutline((o) => this.outlines[o.file] = o.outline));
		this.disposables.push(this.analyzer.registerForFlutterOutline((o) => this.flutterOutlines[o.file] = o.outline));
		this.disposables.push(this.analyzer.registerForAnalysisOccurrences((o) => this.occurrences[o.file] = o.occurrences));
		this.disposables.push(this.analyzer.registerForAnalysisFolding((f) => this.folding[f.file] = f.regions));
		// Handle already-open files.
		this.updatePriorityFiles();
		this.updateSubscriptions();
	}

	public async updatePriorityFiles() {
		const visibleFiles = this.validPathsFor(window.visibleTextEditors.map((editor) => editor.document));

		if (!this.pathsHaveChanged(this.lastPriorityFiles, visibleFiles))
			return;

		// Keep track of files to compare next time.
		this.lastPriorityFiles = visibleFiles;

		// Set priority files.
		try {
			await this.analyzer.analysisSetPriorityFiles({ files: visibleFiles });
		} catch (e) {
			this.logger.error(e);
		}
	}

	public async updateSubscriptions() {
		const openFiles = this.validPathsFor(workspace.textDocuments);

		if (!this.pathsHaveChanged(this.lastSubscribedFiles, openFiles))
			return;

		// Keep track of files to compare next time.
		this.lastSubscribedFiles = openFiles;

		// Set subscriptions.
		try {
			await this.analyzer.analysisSetSubscriptions({
				subscriptions: {
					CLOSING_LABELS: this.analyzer.capabilities.supportsClosingLabels ? openFiles : undefined,
					FOLDING: isUsingLsp ? undefined : openFiles,
					OCCURRENCES: isUsingLsp ? undefined : openFiles,
					OUTLINE: openFiles,
				},
			});
		} catch (e) {
			this.logger.error(e);
		}
		// Set subscriptions.
		if (this.wsContext.hasAnyFlutterProjects && this.analyzer.capabilities.supportsFlutterOutline) {
			try {
				await this.analyzer.flutterSetSubscriptions({
					subscriptions: {
						OUTLINE: openFiles,
					},
				});
			} catch (e) {
				this.logger.error(e);
			}
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

	public getOutlineFor(file: Uri): Outline | undefined {
		return this.outlines[fsPath(file)];
	}

	public getFlutterOutlineFor(file: Uri): FlutterOutline | undefined {
		return this.flutterOutlines[fsPath(file)];
	}

	public getOccurrencesFor(file: Uri): Occurrences[] | undefined {
		return this.occurrences[fsPath(file)];
	}

	public supportsPubRunTest(file: Uri): boolean | undefined {
		const path = fsPath(file);
		if (!util.isPubRunnableTestFile(path))
			return false;
		if (this.pubRunTestSupport[path] === undefined) {
			const projectRoot = locateBestProjectRoot(path);
			this.pubRunTestSupport[path] = !!(projectRoot && util.checkProjectSupportsPubRunTest(projectRoot));
		}
		return this.pubRunTestSupport[fsPath(file)];
	}

	public getFoldingRegionsFor(file: Uri): FoldingRegion[] | undefined {
		return this.folding[fsPath(file)];
	}

	public getLastPriorityFiles(): string[] {
		return this.lastPriorityFiles.slice();
	}

	public getLastSubscribedFiles(): string[] {
		return this.lastSubscribedFiles.slice();
	}

	public dispose(): any {
		// TODO: This (and others) should probably await, in case thye're promises.
		// And also not fail on first error.
		this.disposables.forEach((d) => d.dispose());
	}
}
