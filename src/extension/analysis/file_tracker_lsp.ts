import { CancellationToken, TextDocument, Uri, workspace } from "vscode";
import { LanguageClient } from "vscode-languageclient/node";
import { FlutterOutline, FlutterOutlineParams, Outline, OutlineParams, PublishFlutterOutlineNotification, PublishOutlineNotification } from "../../shared/analysis/lsp/custom_protocol";
import { EventEmitter } from "../../shared/events";
import { IAmDisposable, Logger } from "../../shared/interfaces";
import { disposeAll } from "../../shared/utils";
import { fsPath } from "../../shared/utils/fs";
import { waitFor } from "../../shared/utils/promises";
import { lspToPosition } from "../../shared/vscode/utils";
import { WorkspaceContext } from "../../shared/workspace";
import { locateBestProjectRoot } from "../project";
import * as util from "../utils";

export class LspFileTracker implements IAmDisposable {
	private disposables: IAmDisposable[] = [];
	private readonly outlines: { [key: string]: Outline } = {};
	private readonly flutterOutlines: { [key: string]: FlutterOutline } = {};
	private readonly pubRunTestSupport: { [key: string]: boolean } = {};

	protected readonly onOutlineEmitter = new EventEmitter<OutlineParams>();
	public readonly onOutline = this.onOutlineEmitter.event;
	protected readonly onFlutterOutlineEmitter = new EventEmitter<FlutterOutlineParams>();
	public readonly onFlutterOutline = this.onFlutterOutlineEmitter.event;

	constructor(private readonly logger: Logger, private readonly analyzer: LanguageClient, private readonly wsContext: WorkspaceContext) {
		// tslint:disable-next-line: no-floating-promises
		analyzer.start().then(() => {
			this.analyzer.onNotification(PublishOutlineNotification.type, (n) => {
				const filePath = fsPath(Uri.parse(n.uri));
				this.outlines[filePath] = n.outline;
				this.onOutlineEmitter.fire(n);
			});
			this.analyzer.onNotification(PublishFlutterOutlineNotification.type, (n) => {
				const filePath = fsPath(Uri.parse(n.uri));
				this.flutterOutlines[filePath] = n.outline;
				this.onFlutterOutlineEmitter.fire(n);
			});
		});
		this.watchPubspec();
	}

	public getOutlineFor(file: { fsPath: string } | string): Outline | undefined {
		return this.outlines[fsPath(file)];
	}

	public async waitForOutline(document: TextDocument, token?: CancellationToken): Promise<Outline | undefined> {
		return waitFor(() => this.outlines[fsPath(document.uri)], 50, 5000, token);
	}

	// TODO: Change this to withVersion when server sends versions.
	public async waitForOutlineWithLength(document: TextDocument, length: number, token: CancellationToken): Promise<Outline | undefined> {
		return waitFor(() => {
			const outline = this.outlines[fsPath(document.uri)];
			return outline && document.offsetAt(lspToPosition(outline.range.end)) === length ? outline : undefined;
		}, 50, 5000, token);
	}

	public getFlutterOutlineFor(file: { fsPath: string } | string): FlutterOutline | undefined {
		return this.flutterOutlines[fsPath(file)];
	}

	// TODO: Change this to withVersion when server sends versions.
	public async waitForFlutterOutlineWithLength(document: TextDocument, length: number, token: CancellationToken): Promise<FlutterOutline | undefined> {
		return waitFor(() => {
			const outline = this.flutterOutlines[fsPath(document.uri)];
			return outline && document.offsetAt(lspToPosition(outline.range.end)) === length ? outline : undefined;
		}, 50, 5000, token);
	}

	public supportsPubRunTest(file: { fsPath: string } | string): boolean | undefined {
		if (this.wsContext.config.useVmForTests)
			return false;

		if (this.wsContext.config.supportsPackageTest) {
			return true;
		}

		// TODO: Both FileTrackers have a copy of this!
		const path = fsPath(file);
		if (!util.isPubRunnableTestFile(path))
			return false;
		if (this.pubRunTestSupport[path] === undefined) {
			const projectRoot = locateBestProjectRoot(path);
			this.pubRunTestSupport[path] = !!(projectRoot && util.projectShouldUsePubForTests(projectRoot, this.wsContext.config));
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

	public dispose(): any {
		disposeAll(this.disposables);
	}
}
