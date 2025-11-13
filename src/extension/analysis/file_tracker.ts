import { CancellationToken, TextDocument, Uri, workspace } from "vscode";
import { LanguageClient } from "vscode-languageclient/node";
import { URI } from "vscode-uri";
import { FlutterOutline, FlutterOutlineParams, Outline, OutlineParams, PublishFlutterOutlineNotification, PublishOutlineNotification } from "../../shared/analysis/lsp/custom_protocol";
import { EventEmitter } from "../../shared/events";
import { IAmDisposable, Logger } from "../../shared/interfaces";
import { disposeAll } from "../../shared/utils";
import { DocumentCache } from "../../shared/utils/document_cache";
import { fsPath } from "../../shared/utils/fs";
import { waitFor } from "../../shared/utils/promises";
import { locateBestProjectRoot } from "../../shared/vscode/project";
import { lspToPosition } from "../../shared/vscode/utils";
import { WorkspaceContext } from "../../shared/workspace";
import * as util from "../utils";

export class FileTracker implements IAmDisposable {
	private disposables: IAmDisposable[] = [];
	private readonly outlines = new DocumentCache<Outline>();
	private readonly flutterOutlines = new DocumentCache<FlutterOutline>();
	private readonly pubRunTestSupport = new DocumentCache<boolean>();

	protected readonly onOutlineEmitter = new EventEmitter<OutlineParams>();
	public readonly onOutline = this.onOutlineEmitter.event;
	protected readonly onFlutterOutlineEmitter = new EventEmitter<FlutterOutlineParams>();
	public readonly onFlutterOutline = this.onFlutterOutlineEmitter.event;

	constructor(private readonly logger: Logger, private readonly analyzer: LanguageClient, private readonly wsContext: WorkspaceContext) {
		void analyzer.start().then(() => {
			this.analyzer.onNotification(PublishOutlineNotification.type, (n) => {
				const uri = Uri.parse(n.uri);
				this.outlines.set(uri, n.outline);
				this.onOutlineEmitter.fire(n);
			});
			this.analyzer.onNotification(PublishFlutterOutlineNotification.type, (n) => {
				const uri = Uri.parse(n.uri);
				this.flutterOutlines.set(uri, n.outline);
				this.onFlutterOutlineEmitter.fire(n);
			});
		});
		this.watchPubspec();
	}

	public getOutlineFor(uri: URI): Outline | undefined {
		return this.outlines.get(uri);
	}

	public async waitForOutline(document: TextDocument, token?: CancellationToken): Promise<Outline | undefined> {
		return waitFor(() => this.outlines.get(document.uri), 50, 5000, token);
	}

	// TODO: Change this to withVersion when server sends versions.
	public async waitForOutlineWithLength(document: TextDocument, length: number, token: CancellationToken): Promise<Outline | undefined> {
		return waitFor(() => {
			const outline = this.outlines.get(document.uri);
			return outline && document.offsetAt(lspToPosition(outline.range.end)) === length ? outline : undefined;
		}, 50, 5000, token);
	}

	public getFlutterOutlineFor(uri: URI): FlutterOutline | undefined {
		return this.flutterOutlines.get(uri);
	}

	// TODO: Change this to withVersion when server sends versions.
	public async waitForFlutterOutlineWithLength(document: TextDocument, length: number, token: CancellationToken): Promise<FlutterOutline | undefined> {
		return waitFor(() => {
			const outline = this.flutterOutlines.get(document.uri);
			return outline && document.offsetAt(lspToPosition(outline.range.end)) === length ? outline : undefined;
		}, 50, 5000, token);
	}

	public supportsPackageTest(uri: URI): boolean | undefined {
		// Handle explicit flags.
		if (this.wsContext.config.supportsPackageTest === true)
			return true;
		else if (this.wsContext.config.supportsPackageTest === false)
			return false;

		// TODO: Both FileTrackers have a copy of this!
		const filePath = fsPath(uri);
		if (!util.isRunnableTestFile(filePath))
			return false;
		if (!this.pubRunTestSupport.has(uri)) {
			const projectRoot = locateBestProjectRoot(filePath);
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

	public dispose(): any {
		disposeAll(this.disposables);
	}
}
