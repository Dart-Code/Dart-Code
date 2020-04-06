import { ProgressLocation, window } from "vscode";
import { Analyzer } from "../../shared/analyzer";
import { PromiseCompleter } from "../../shared/utils";

export class LspAnalyzerStatusReporter {
	private analysisInProgress = false;
	private analyzingPromise?: PromiseCompleter<void>;

	constructor(readonly analyzer: Analyzer) {
		analyzer.onAnalysisStatusChange.listen((params) => this.handleServerStatus(params.isAnalyzing));
	}

	private handleServerStatus(isAnalyzing: boolean) {
		this.analysisInProgress = isAnalyzing;

		if (this.analysisInProgress) {
			// Debounce short analysis times.
			setTimeout(() => {
				// When the timeout fires, we need to check analysisInProgress again in case
				// analysis has already finished.
				if (this.analysisInProgress && !this.analyzingPromise) {
					window.withProgress({ location: ProgressLocation.Window, title: "Analyzing…" }, (_) => {
						if (!this.analyzingPromise) // Re-check, since we don't know how long before this callback is called.
							this.analyzingPromise = new PromiseCompleter();
						return this.analyzingPromise.promise;
					});
				}
			}, 100);
		} else {
			if (this.analyzingPromise) {
				this.analyzingPromise.resolve();
				this.analyzingPromise = undefined;
			}
		}
	}

}
