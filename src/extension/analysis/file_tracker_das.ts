import { CancellationToken, Disposable, TextDocument, Uri, window, workspace } from "vscode";
import { AnalysisGetNavigationResponse, AnalysisNavigationNotification, FilePath, FlutterOutline, FoldingRegion, NavigationRegion, Occurrences, Outline } from "../../shared/analysis_server_types";
import { IAmDisposable, Logger } from "../../shared/interfaces";
import { disposeAll } from "../../shared/utils";
import { DocumentCache } from "../../shared/utils/document_cache";
import { fsPath } from "../../shared/utils/fs";
import { waitFor } from "../../shared/utils/promises";
import { WorkspaceContext } from "../../shared/workspace";
import { locateBestProjectRoot } from "../project";
import * as util from "../utils";
import { DasAnalyzerClient } from "./analyzer_das";

export class DasFileTracker implements IAmDisposable {
	private disposables: Disposable[] = [];
	private readonly navigations = new DocumentCache<AnalysisNavigationNotification>();
	private readonly outlines = new DocumentCache<Outline>();
	private readonly flutterOutlines = new DocumentCache<FlutterOutline>();
	private readonly occurrences = new DocumentCache<Occurrences[]>();
	private readonly folding = new DocumentCache<FoldingRegion[]>();
	private readonly pubRunTestSupport = new DocumentCache<boolean>();
	private lastPriorityFiles: string[] = [];
	private lastSubscribedFiles: string[] = [];

	constructor(private readonly logger: Logger, private readonly analyzer: DasAnalyzerClient, private readonly wsContext: WorkspaceContext) {
		// Reset these, since they're state from the last analysis server
		// (when we change SDK and thus change this).
		this.lastPriorityFiles = [];
		this.lastSubscribedFiles = [];

		this.disposables.push(workspace.onDidOpenTextDocument(async (td) => {
			await this.updateSubscriptions();
		}));
		this.disposables.push(workspace.onDidCloseTextDocument(async (td) => {
			const uri = td.uri;
			this.navigations.delete(uri);
			this.outlines.delete(uri);
			this.flutterOutlines.delete(uri);
			this.occurrences.delete(uri);
			this.folding.delete(uri);
			this.pubRunTestSupport.delete(uri);
			await this.updateSubscriptions();
		}));
		this.disposables.push(window.onDidChangeVisibleTextEditors((e) => this.updatePriorityFiles()));
		this.disposables.push(this.analyzer.registerForAnalysisNavigation((n) => this.navigations.set(Uri.file(n.file), n)));
		this.disposables.push(this.analyzer.registerForAnalysisOutline((o) => this.outlines.set(Uri.file(o.file), o.outline)));
		this.disposables.push(this.analyzer.registerForFlutterOutline((o) => this.flutterOutlines.set(Uri.file(o.file), o.outline)));
		this.disposables.push(this.analyzer.registerForAnalysisOccurrences((o) => this.occurrences.set(Uri.file(o.file), o.occurrences)));
		this.disposables.push(this.analyzer.registerForAnalysisFolding((f) => this.folding.set(Uri.file(f.file), f.regions)));
		// It's possible that after the server gives us the version, we may send different subscriptions (eg.
		// based on capabilities, like supporting priority files outside of the workspace root) so we may need
		// to send again.
		this.disposables.push(this.analyzer.registerForServerConnected((s) => this.updateSubscriptions(true)));
		// Handle already-open files.
		void this.updatePriorityFiles();
		void this.updateSubscriptions();
		this.watchPubspec();
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

	public async updateSubscriptions(force = false) {
		const openFiles = this.validPathsFor(workspace.textDocuments);

		if (!force && !this.pathsHaveChanged(this.lastSubscribedFiles, openFiles))
			return;

		// Keep track of files to compare next time.
		this.lastSubscribedFiles = openFiles;

		// Set subscriptions.
		try {
			await this.analyzer.analysisSetSubscriptions({
				subscriptions: {
					CLOSING_LABELS: this.analyzer.capabilities.supportsClosingLabels ? openFiles : undefined,
					// TODO(dantup): Why are we checking this here? This class is DAS-specific?
					FOLDING: openFiles,
					NAVIGATION: openFiles,
					OCCURRENCES: openFiles,
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

	private validPathsFor(paths: readonly TextDocument[]): string[] {
		const isAnalyzeable = this.analyzer.capabilities.supportsPriorityFilesOutsideAnalysisRoots
			? util.isAnalyzable
			: util.isAnalyzableAndInWorkspace;

		return paths
			.filter((doc) => !doc.isClosed && isAnalyzeable(doc))
			.map((doc) => fsPath(doc.uri))
			.sort((path1, path2) => path1.localeCompare(path2));
	}

	public getNavigationTargets(file: FilePath, offset: number): AnalysisGetNavigationResponse | undefined {
		// Synthesize an AnalysisGetNavigationResponse based on our existing knowledge about navigation links in the file.
		const notification = this.navigations.get(Uri.file(file));
		const region = notification?.regions?.find((region) => this.offsetWithinNavigationRegion(region, offset));
		if (!region || !notification) return undefined;
		return {
			files: notification.files,
			regions: [region],
			targets: notification.targets,
		};
	}

	private offsetWithinNavigationRegion(region: NavigationRegion, offset: number): boolean {
		return offset >= region.offset && offset < region.offset + region.length;
	}

	public getOutlineFor(uri: Uri): Outline | undefined {
		return this.outlines.get(uri);
	}

	public async waitForOutlineWithLength(uri: Uri, length: number, token: CancellationToken): Promise<Outline | undefined> {
		return waitFor(() => {
			const outline = this.outlines.get(uri);
			return outline?.length === length ? outline : undefined;
		}, 50, 5000, token);
	}

	public getFlutterOutlineFor(uri: Uri): FlutterOutline | undefined {
		return this.flutterOutlines.get(uri);
	}

	public async waitForFlutterOutlineWithLength(uri: Uri, length: number, token: CancellationToken): Promise<FlutterOutline | undefined> {
		return waitFor(() => {
			const outline = this.flutterOutlines.get(uri);
			return outline?.length === length ? outline : undefined;
		}, 50, 5000, token);
	}

	public getOccurrencesFor(uri: Uri): Occurrences[] | undefined {
		return this.occurrences.get(uri);
	}

	public supportsPubRunTest(uri: Uri): boolean | undefined {
		// TODO: Both FileTrackers have a copy of this!
		const path = fsPath(uri);
		if (!util.isRunnableTestFile(path))
			return false;
		if (!this.pubRunTestSupport.has(uri)) {
			const projectRoot = locateBestProjectRoot(path);
			this.pubRunTestSupport.set(uri, !!(projectRoot && util.projectCanUsePackageTest(projectRoot, this.wsContext.config)));
		}
		return this.pubRunTestSupport.get(uri);
	}

	private watchPubspec() {
		const clearCachedPubRunTestData = () => this.pubRunTestSupport.clear();

		const watcher = workspace.createFileSystemWatcher("**/pubspec.yaml");
		this.disposables.push(watcher);
		watcher.onDidChange(clearCachedPubRunTestData, this);
		watcher.onDidCreate(clearCachedPubRunTestData, this);
	}

	public getFoldingRegionsFor(uri: Uri): FoldingRegion[] | undefined {
		return this.folding.get(uri);
	}

	public getLastPriorityFiles(): string[] {
		return this.lastPriorityFiles.slice();
	}

	public getLastSubscribedFiles(): string[] {
		return this.lastSubscribedFiles.slice();
	}

	public dispose(): any {
		disposeAll(this.disposables);
	}
}
