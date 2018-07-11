import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { ProgressLocation, env, version as codeVersion, window, workspace } from "vscode";
import { Analytics } from "../analytics";
import { config } from "../config";
import { LogCategory, PromiseCompleter } from "../debug/utils";
import { ProjectType, Sdks, extensionVersion, getRandomInt, getSdkVersion, isStableSdk } from "../utils";
import { logError } from "../utils/log";
import { RequestError, ServerErrorNotification, ServerStatusNotification } from "./analysis_server_types";
import { Analyzer } from "./analyzer";

const maxErrorReportCount = 3;
const sendFakeErrorAtStartup = false;

let errorCount = 0;

export class AnalyzerStatusReporter {
	private analysisInProgress: boolean;
	private analyzer: Analyzer;
	private sdks: Sdks;
	private analytics: Analytics;
	private analyzingPromise: PromiseCompleter<void>;

	constructor(analyzer: Analyzer, sdks: Sdks, analytics: Analytics) {
		this.analyzer = analyzer;
		this.sdks = sdks;
		this.analytics = analytics;
		analyzer.registerForServerStatus((n) => this.handleServerStatus(n));
		analyzer.registerForServerError((e) => this.handleServerError(e));
		analyzer.registerForRequestError((e) => this.handleRequestError(e));

		if (sendFakeErrorAtStartup) {
			setTimeout(() => {
				this.handleServerError(
					{
						isFatal: false,
						message: "This is a fake error for testing the error reporting!",
						stackTrace: new Error().stack,
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
					this.analyzingPromise = new PromiseCompleter();
					window.withProgress({ location: ProgressLocation.Window, title: "Analyzing…" }, (_) => this.analyzingPromise.promise);
				}
			}, 500);
		} else {
			if (this.analyzingPromise) {
				this.analyzingPromise.resolve();
				this.analyzingPromise = null;
			}
		}
	}

	private handleRequestError(error: RequestError & { method?: string }) {
		// Map this request error to a server error to reuse the shared code.
		this.handleServerError(
			{
				isFatal: false,
				message: error.message,
				stackTrace: error.stackTrace,
			},
			error.method,
		);
	}

	private handleServerError(error: ServerErrorNotification, method?: string) {
		// Always log to the console.
		logError(error.message, LogCategory.Analyzer);
		if (error.stackTrace)
			logError(error.stackTrace, LogCategory.Analyzer);

		this.analytics.logAnalyzerError((method ? `(${method}) ` : "") + error.message, error.isFatal);

		errorCount++;

		// Offer to report the error.
		if (config.reportAnalyzerErrors && errorCount <= maxErrorReportCount && this.shouldReportErrors()) {
			const shouldReport: string = "Generate error report";
			window.showErrorMessage(`Exception from the Dart analysis server: ${error.message}`, shouldReport).then((res) => {
				if (res === shouldReport)
					this.reportError(error, method);
			});
		}
	}

	private shouldReportErrors(): boolean {
		if (this.sdks.projectType === ProjectType.Flutter && this.sdks.flutter)
			return !isStableSdk(getSdkVersion(this.sdks.flutter));
		else
			return !isStableSdk(getSdkVersion(this.sdks.dart));
	}

	private reportError(error: ServerErrorNotification, method?: string) {
		const sdkVersion = getSdkVersion(this.sdks.dart);
		const flutterSdkVersion = getSdkVersion(this.sdks.flutter);

		// Attempt to get the last diagnostics
		const diagnostics = this.analyzer.getLastDiagnostics();
		const analyzerArgs = this.analyzer.getAnalyzerLaunchArgs();

		const data = `
Please review the below report for any information you do not wish to share and report to
  https://github.com/dart-lang/sdk/issues/new

Exception from analysis server (running from VSCode / Dart Code)

### What I was doing

(please describe what you were doing when this exception occurred)
${method ? "\n### Request\n\nWhile responding to request: `" + method + "`\n" : ""}
### Versions

- ${flutterSdkVersion ? `Flutter SDK ${flutterSdkVersion}` : `Dart SDK ${sdkVersion}`}
- ${env.appName} ${codeVersion}
- Dart Code ${extensionVersion}

### Analyzer Info

The analyzer was launched using the arguments:

\`\`\`text
${analyzerArgs.join("\n")}
\`\`\`

### Exception${error.isFatal ? " (fatal)" : ""}

${error.message}

\`\`\`text
${error.stackTrace.trim()}
\`\`\`
${diagnostics ? "\nDiagnostics requested after the error occurred are:\n\n```js\n" + JSON.stringify(diagnostics, null, 4) + "\n```\n" : ""}
`;

		const fileName = `bug-${getRandomInt(0x1000, 0x10000).toString(16)}.md`;
		const tempPath = path.join(os.tmpdir(), fileName);
		fs.writeFileSync(tempPath, data);
		workspace.openTextDocument(tempPath).then((document) => {
			window.showTextDocument(document);
		});
	}
}
