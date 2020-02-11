import { Uri } from "vscode";
import { LanguageClient } from "vscode-languageclient";
import { FlutterOutline, FlutterOutlineParams, Outline, OutlineParams, PublishFlutterOutlineNotification, PublishOutlineNotification } from "../../shared/analysis/lsp/custom_protocol";
import { EventEmitter } from "../../shared/events";
import { IAmDisposable, Logger } from "../../shared/interfaces";
import { fsPath } from "../../shared/utils/fs";
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

	constructor(private readonly logger: Logger, private readonly analyzer: LanguageClient) {
		analyzer.onReady().then(() => {
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
	}

	public getOutlineFor(file: { fsPath: string } | string): Outline | undefined {
		return this.outlines[fsPath(file)];
	}

	public getFlutterOutlineFor(file: { fsPath: string } | string): FlutterOutline | undefined {
		return this.flutterOutlines[fsPath(file)];
	}

	public supportsPubRunTest(file: { fsPath: string } | string): boolean | undefined {
		// TODO: Both FileTrackers have a copy of this!
		const path = fsPath(file);
		if (!util.isPubRunnableTestFile(path))
			return false;
		if (this.pubRunTestSupport[path] === undefined) {
			const projectRoot = locateBestProjectRoot(path);
			this.pubRunTestSupport[path] = !!(projectRoot && util.checkProjectSupportsPubRunTest(projectRoot));
		}
		return this.pubRunTestSupport[fsPath(file)];
	}

	public dispose(): any {
		// TODO: This (and others) should probably await, in case thye're promises.
		// And also not fail on first error.
		this.disposables.forEach((d) => d.dispose());
	}
}
