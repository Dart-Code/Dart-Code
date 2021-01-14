import { ProgressLocation, window } from "vscode";
import { Analyzer, AnalyzingEvent } from "../../shared/analyzer";
import { PromiseCompleter } from "../../shared/utils";

// TODO: Remove this class once Flutter Stable has an LSP server that uses $/progress.

export class LspAnalyzerStatusReporter {
	private analysisInProgress = false;
	private analyzingPromise?: PromiseCompleter<void>;

	constructor(readonly analyzer: Analyzer) {
		analyzer.onAnalysisStatusChange.listen((params) => this.handleServerStatus(params));
	}

	private handleServerStatus(params: AnalyzingEvent) {
		if (params.suppressProgress) {
			return;
		}
		this.analysisInProgress = params.isAnalyzing;

		if (this.analysisInProgress) {
			// Debounce short analysis times.
			setTimeout(() => {
				// When the timeout fires, we need to check analysisInProgress again in case
				// analysis has already finished.
				if (this.analysisInProgress && !this.analyzingPromise) {
					window.withProgress({ location: ProgressLocation.Window, title: "Analyzing…" }, () => {
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
