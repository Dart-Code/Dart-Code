"use strict";

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { analytics } from "./analytics";
import { window, workspace, env, commands, extensions, StatusBarItem, Disposable, TextDocument, version as codeVersion } from "vscode";
import { Analyzer } from "./analysis/analyzer";
import { ServerStatusNotification, ServerErrorNotification, RequestError } from "./analysis/analysis_server_types";
import { config } from "./config";
import { dartSdkRoot } from "./extension";
import { getDartSdkVersion } from "./utils";

const maxErrorReportCount = 3;

let errorCount = 0;

// TODO: We should show in the status line when the analysis server's process is dead.

export class AnalyzerStatusReporter extends Disposable {
	private statusBarItem: StatusBarItem;
	private statusShowing: boolean;

	constructor(analyzer: Analyzer) {
		super(() => this.statusBarItem.dispose());

		this.statusBarItem = window.createStatusBarItem();
		this.statusBarItem.text = "Analyzing…";

		analyzer.registerForServerStatus(n => this.handleServerStatus(n));
		analyzer.registerForServerError(e => this.handleServerError(e));
		analyzer.registerForRequestError(e => this.handleRequestError(e));
	}

	private handleServerStatus(status: ServerStatusNotification) {
		if (!status.analysis)
			return;

		this.statusShowing = status.analysis.isAnalyzing;

		if (this.statusShowing) {
			// Debounce short analysis times.
			setTimeout(() => {
				if (this.statusShowing)
					this.statusBarItem.show();
			}, 250);
		} else {
			this.statusBarItem.hide();
		}
	}

	handleRequestError(error: RequestError) {
		// Map this request error to a server error to reuse the shared code.
		this.handleServerError({
			isFatal: false,
			message: error.message,
			stackTrace: error.stackTrace
		});
	}

	private handleServerError(error: ServerErrorNotification) {
		// Always log to the console.
		console.error(error.message);
		if (error.stackTrace)
			console.error(error.stackTrace);

		analytics.logAnalyzerError(error.message, error.isFatal);

		errorCount++;

		// Offer to report the error.
		if (config.reportAnalyzerErrors && errorCount <= maxErrorReportCount) {
			const shouldReport: string = "Generate error report";
			window.showErrorMessage(`Exception from the Dart analysis server: ${error.message}`, shouldReport).then(res => {
				if (res == shouldReport)
					this.reportError(error);
			});
		}
	}

	private reportError(error: ServerErrorNotification) {
		let sdkVersion = getDartSdkVersion(dartSdkRoot);
		let dartCodeVersion = extensions.getExtension('DanTup.dart-code').packageJSON.version;

		let data = `
Please report the following to https://github.com/dart-lang/sdk/issues/new :

Exception from analysis server (running from VSCode / Dart Code)

### What I was doing

(please describe what you were doing when this exception occurred)

### Versions

- Dart SDK ${sdkVersion}
- ${env.appName} ${codeVersion}
- Dart Code ${dartCodeVersion}

### Exception ${error.isFatal ? ' (Fatal)' : ''}

${error.message}

\`\`\`text
${error.stackTrace.trim()}
\`\`\`
`;

		let fileName = `bug-${getRandomInt(0x1000, 0x10000).toString(16)}.md`;
		let tempPath = path.join(os.tmpdir(), fileName);
		fs.writeFileSync(tempPath, data, 'utf8');
		workspace.openTextDocument(tempPath).then(document => {
			window.showTextDocument(document);
		});
	}
}

function getRandomInt(min: number, max: number) {
	min = Math.ceil(min);
	max = Math.floor(max);
	return Math.floor(Math.random() * (max - min)) + min;
}
