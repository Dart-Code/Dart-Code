import { CancellationToken, Disposable, TextDocument, Uri, window, workspace } from "vscode";
import { AnalysisGetNavigationResponse, AnalysisNavigationNotification, FilePath, FlutterOutline, FoldingRegion, NavigationRegion, Occurrences, Outline } from "../../shared/analysis_server_types";
import { IAmDisposable, Logger } from "../../shared/interfaces";
import { disposeAll } from "../../shared/utils";
import { fsPath } from "../../shared/utils/fs";
import { waitFor } from "../../shared/utils/promises";
import { WorkspaceContext } from "../../shared/workspace";
import { locateBestProjectRoot } from "../project";
import * as util from "../utils";
import { DasAnalyzerClient } from "./analyzer_das";

export class DasFileTracker implements IAmDisposable {
	private disposables: Disposable[] = [];
	private readonly navigations: { [key: string]: AnalysisNavigationNotification } = {};
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

		this.disposables.push(workspace.onDidOpenTextDocument(async (td) => {
			await this.updateSubscriptions();
		}));
		this.disposables.push(workspace.onDidCloseTextDocument(async (td) => {
			const path = fsPath(td.uri);
			delete this.navigations[path];
			delete this.outlines[path];
			delete this.flutterOutlines[path];
			delete this.occurrences[path];
			delete this.folding[path];
			delete this.pubRunTestSupport[path];
			await this.updateSubscriptions();
		}));
		this.disposables.push(window.onDidChangeVisibleTextEditors((e) => this.updatePriorityFiles()));
		this.disposables.push(this.analyzer.registerForAnalysisNavigation((n) => this.navigations[n.file] = n));
		this.disposables.push(this.analyzer.registerForAnalysisOutline((o) => this.outlines[o.file] = o.outline));
		this.disposables.push(this.analyzer.registerForFlutterOutline((o) => this.flutterOutlines[o.file] = o.outline));
		this.disposables.push(this.analyzer.registerForAnalysisOccurrences((o) => this.occurrences[o.file] = o.occurrences));
		this.disposables.push(this.analyzer.registerForAnalysisFolding((f) => this.folding[f.file] = f.regions));
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
					FOLDING: this.wsContext.config.useLegacyProtocol ? openFiles : undefined,
					NAVIGATION: this.wsContext.config.useLegacyProtocol ? openFiles : undefined,
					OCCURRENCES: this.wsContext.config.useLegacyProtocol ? openFiles : undefined,
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
		const notification = this.navigations[file];
		const region = notification?.regions?.find((region) => this.offsetWithinNavigationRegion(region, offset));
		if (!region) return undefined;
		return {
			files: notification.files,
			regions: [region],
			targets: notification.targets,
		};
	}

	private offsetWithinNavigationRegion(region: NavigationRegion, offset: number): boolean {
		return offset >= region.offset && offset < region.offset + region.length;
	}

	public getOutlineFor(file: Uri): Outline | undefined {
		return this.outlines[fsPath(file)];
	}

	public async waitForOutlineWithLength(file: Uri, length: number, token: CancellationToken): Promise<Outline | undefined> {
		return waitFor(() => {
			const outline = this.outlines[fsPath(file)];
			return outline?.length === length ? outline : undefined;
		}, 50, 5000, token);
	}

	public getFlutterOutlineFor(file: Uri): FlutterOutline | undefined {
		return this.flutterOutlines[fsPath(file)];
	}

	public async waitForFlutterOutlineWithLength(file: Uri, length: number, token: CancellationToken): Promise<FlutterOutline | undefined> {
		return waitFor(() => {
			const outline = this.flutterOutlines[fsPath(file)];
			return outline?.length === length ? outline : undefined;
		}, 50, 5000, token);
	}

	public getOccurrencesFor(file: Uri): Occurrences[] | undefined {
		return this.occurrences[fsPath(file)];
	}

	public supportsPubRunTest(file: Uri): boolean | undefined {
		// TODO: Both FileTrackers have a copy of this!
		const path = fsPath(file);
		if (!util.isRunnableTestFile(path))
			return false;
		if (this.pubRunTestSupport[path] === undefined) {
			const projectRoot = locateBestProjectRoot(path);
			this.pubRunTestSupport[path] = !!(projectRoot && util.projectCanUsePackageTest(projectRoot, this.wsContext.config));
		}
		return this.pubRunTestSupport[fsPath(file)];
	}

	private watchPubspec() {
		const clearCachedPubRunTestData = () => Object.keys(this.pubRunTestSupport).forEach((f) => delete this.pubRunTestSupport[f]);

		const watcher = workspace.createFileSystemWatcher("**/pubspec.yaml");
		this.disposables.push(watcher);
		watcher.onDidChange(clearCachedPubRunTestData, this);
		watcher.onDidCreate(clearCachedPubRunTestData, this);
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
		disposeAll(this.disposables);
	}
}
