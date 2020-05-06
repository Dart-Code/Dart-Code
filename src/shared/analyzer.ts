import { EventEmitter } from "./events";
import { IAmDisposable, Logger } from "./interfaces";
import { PromiseCompleter } from "./utils";
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

	protected readonly onAnalysisStatusChangeEmitter = new EventEmitter<{ isAnalyzing: boolean }>();
	public readonly onAnalysisStatusChange = this.onAnalysisStatusChangeEmitter.event;
	private isAnalyzing = false;

	public abstract getDiagnosticServerPort(): Promise<{ port: number }>;

	constructor(protected readonly logger: Logger) {
		this.disposables.push(this.onAnalysisStatusChangeEmitter);
		// tslint:disable-next-line: no-floating-promises
		this.setup();
	}

	private async setup(): Promise<void> {
		await this.onReady;
		this.onAnalysisStatusChange.listen((status) => {
			this.isAnalyzing = status.isAnalyzing;
			if (!status.isAnalyzing) {
				this.onAnalysisCompleteCompleter.resolve();
				this.onAnalysisCompleteCompleter = new PromiseCompleter<void>();
			}
		});
	}

	public dispose(): void | Promise<void> {
		this.disposables.forEach((d) => d.dispose());
	}
}
