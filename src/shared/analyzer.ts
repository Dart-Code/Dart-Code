import { EventEmitter } from "./events";
import { IAmDisposable, Logger } from "./interfaces";
import { PromiseCompleter, disposeAll } from "./utils";
import { resolvedPromise } from "./utils/promises";

export abstract class Analyzer implements IAmDisposable {
	protected disposables: IAmDisposable[] = [];

	protected readonly onReadyCompleter = new PromiseCompleter<void>();
	public readonly onReady = this.onReadyCompleter.promise;

	private onAnalysisCompleteCompleter = new PromiseCompleter<void>();
	// InitialAnalysis uses the very first promise from onAnalysisCompleteCompleter.
	public readonly onInitialAnalysis = this.onAnalysisCompleteCompleter.promise;

	public get onCurrentAnalysisComplete() { return this.isAnalyzing ? this.onAnalysisCompleteCompleter.promise : resolvedPromise; }
	public get onNextAnalysisComplete() { return this.onAnalysisCompleteCompleter.promise; }

	// TODO: Remove suppressProgress when non-LSP is gone and Flutter stable has LSP server that uses $/progress.
	protected readonly onAnalysisStatusChangeEmitter = new EventEmitter<AnalyzingEvent>();
	public readonly onAnalysisStatusChange = this.onAnalysisStatusChangeEmitter.event;
	private isAnalyzing = false;

	public abstract getDiagnosticServerPort(): Promise<{ port: number }>;
	public abstract forceReanalyze(): Promise<void>;

	constructor(protected readonly logger: Logger) {
		this.disposables.push(this.onAnalysisStatusChangeEmitter);
		void this.setup();
	}

	private async setup(): Promise<void> {
		await this.onReady;
		this.onAnalysisStatusChange((status) => {
			this.isAnalyzing = status.isAnalyzing;
			if (!status.isAnalyzing) {
				this.onAnalysisCompleteCompleter.resolve();
				this.onAnalysisCompleteCompleter = new PromiseCompleter<void>();
			}
		});
	}

	public dispose(): void | Promise<void> {
		disposeAll(this.disposables);
	}
}

export interface AnalyzingEvent {
	isAnalyzing: boolean;
	suppressProgress?: boolean;
}
