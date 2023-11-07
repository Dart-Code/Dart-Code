import { ProgressLocation, version as codeVersion, env, window } from "vscode";
import { RequestError, ServerErrorNotification, ServerStatusNotification } from "../../shared/analysis_server_types";
import { LogCategory } from "../../shared/enums";
import { Logger } from "../../shared/interfaces";
import { PromiseCompleter } from "../../shared/utils";
import { extensionVersion } from "../../shared/vscode/extension_utils";
import { WorkspaceContext } from "../../shared/workspace";
import { Analytics } from "../analytics";
import { config } from "../config";
import { openLogContents } from "../utils";
import { DasAnalyzerClient } from "./analyzer_das";

const maxErrorReportCount = 3;
const sendFakeErrorAtStartup = false;

let errorCount = 0;

export class AnalyzerStatusReporter {
	private analysisInProgress = false;
	private analyzingPromise?: PromiseCompleter<void>;

	constructor(private readonly logger: Logger, private readonly analyzer: DasAnalyzerClient, private readonly workspaceContext: WorkspaceContext, private readonly analytics: Analytics) {
		// TODO: Should these go in disposables?
		// If so, do we need to worry about server cleaning them up if it disposes first?
		analyzer.registerForServerStatus((n) => this.handleServerStatus(n));
		analyzer.registerForServerError((e: ServerErrorNotification) => this.handleServerError(e));
		analyzer.registerForRequestError((e: RequestError) => this.handleRequestError(e));
		analyzer.registerForServerTerminated(() => this.handleServerTerminated());

		if (sendFakeErrorAtStartup) {
			setTimeout(() => {
				this.handleServerError(
					{
						isFatal: false,
						message: "This is a fake error for testing the error reporting!",
						stackTrace: new Error().stack || "",
					},
					"testError",
				);
			}, 5000);
		}
	}

	private handleServerStatus(status: ServerStatusNotification) {
		if (!status.analysis)
			return;

		this.analysisInProgress = status.analysis.isAnalyzing;

		if (this.analysisInProgress) {
			// Debounce short analysis times.
			setTimeout(() => {
				// When the timeout fires, we need to check analysisInProgress again in case
				// analysis has already finished.
				if (this.analysisInProgress && !this.analyzingPromise) {
					void window.withProgress({ location: ProgressLocation.Window, title: "Analyzing…" }, () => {
						if (!this.analyzingPromise) // Re-check, since we don't know how long before this callback is called.
							this.analyzingPromise = new PromiseCompleter();
						return this.analyzingPromise.promise;
					});
				}
			}, 500);
		} else {
			if (this.analyzingPromise) {
				this.analyzingPromise.resolve();
				this.analyzingPromise = undefined;
			}
		}
	}

	private handleServerTerminated() {
		this.analysisInProgress = false;
		if (this.analyzingPromise) {
			this.analyzingPromise.resolve();
			this.analyzingPromise = undefined;
		}
	}

	private handleRequestError(error: RequestError & { method?: string }) {
		// Map this request error to a server error to reuse the shared code.
		this.handleServerError(
			{
				isFatal: false,
				message: error.message,
				stackTrace: error.stackTrace || "",
			},
			error.method,
		);
	}

	private handleServerError(error: ServerErrorNotification, method?: string) {
		// Always log to the console.
		this.logger.error(error.message, LogCategory.Analyzer);
		if (error.stackTrace)
			this.logger.error(error.stackTrace, LogCategory.Analyzer);


		errorCount++;

		// Offer to report the error.
		if (config.notifyAnalyzerErrors && errorCount <= maxErrorReportCount) {
			const showLog = "Show log";
			void window.showErrorMessage(`Exception from the Dart analysis server: ${error.message}`, showLog).then((res) => {
				if (res === showLog)
					void this.showErrorLog(error, method);
			});
		}
	}

	private async showErrorLog(error: ServerErrorNotification, method?: string) {
		const sdkVersion = this.workspaceContext.sdks.dartVersion;
		const flutterSdkVersion = this.workspaceContext.sdks.flutterVersion;

		const analyzerArgs = this.analyzer.getAnalyzerLaunchArgs();

		const data = `
${method ? "### Request\n\nServer was responding to request: `" + method + "`\n" : ""}
### Versions

- ${env.appName} v${codeVersion}
- Dart Code v${extensionVersion}
- ${flutterSdkVersion ? `Flutter SDK v${flutterSdkVersion}` : `Dart SDK v${sdkVersion}`}

### Analyzer Info

The analyzer was launched using the arguments:

${analyzerArgs.map((a) => `- ${a}`).join("\n")}

### Exception${error.isFatal ? " (fatal)" : ""}

${error.message}

${error.stackTrace.trim()}
`;

		await openLogContents("md", data);
	}
}
